"""
Version numbering under concurrency.

`next_version_number()` is a read-then-write: `MAX(version_number) + 1`. Two
simultaneous saves would both read 5, both try to insert 6, and one would die
on the unique constraint — a 500 for a user who did nothing wrong.

These tests run genuinely concurrent transactions against the real database to
show the lock closes that window. They need `transaction=True` so each thread
gets its own connection and commits are visible across them; the in-memory
wrapping transaction pytest-django normally uses would hide the race entirely.

Removing `select_for_update` from `lock_document` makes the restore and
revision tests fail deterministically. It is worth knowing why the *edit*
tests are less sensitive: `update_document` saves the document before
appending its version, and that UPDATE takes an implicit row lock for the rest
of the transaction, which accidentally serialises the version insert behind it.
`restore_version` appends the version first, so nothing protects it but the
explicit lock — and the revision counter is unprotected in both paths, which
is why six concurrent writers all wrote `revision=2` without it.

The explicit lock is therefore load-bearing, and not merely belt-and-braces.
"""

import threading
from typing import Any

import pytest
from django.db import connections

from apps.documents import services
from apps.documents.models import Document, DocumentVersion

pytestmark = pytest.mark.django_db(transaction=True)

THREADS = 6


def run_concurrently(target, count: int) -> list[BaseException]:
    """
    Run `target` in `count` threads released at the same instant.

    A barrier rather than plain starts: without it the threads trickle in and
    the interleaving that causes the bug never happens, so the test would pass
    against broken code.
    """
    barrier = threading.Barrier(count)
    errors: list[BaseException] = []
    lock = threading.Lock()

    def worker(index: int) -> None:
        try:
            barrier.wait(timeout=10)
            target(index)
        except BaseException as exc:
            with lock:
                errors.append(exc)
        finally:
            # Threads own their connections; leaking them exhausts the pool
            # and makes later tests fail for unrelated reasons.
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    return errors


@pytest.fixture
def concurrent_document(django_db_setup, django_db_blocker) -> Any:
    """
    A committed document the worker threads can all see.

    Built directly rather than through the usual fixtures because those run
    inside the test's transaction, which a separate connection cannot observe.
    """
    from django.contrib.auth import get_user_model

    from apps.workspaces import services as workspace_services

    User = get_user_model()

    author = User.objects.create_user(
        email="concurrency@streamsync.test", name="Concurrency", password=None
    )
    workspace = workspace_services.create_workspace(owner=author, name="Concurrency")
    document = services.create_document(
        workspace=workspace, author=author, title="Contended", content="<p>v1</p>"
    )

    yield document

    # transaction=True truncates tables between tests, but the objects created
    # here are committed, so they are cleaned up explicitly for clarity.
    DocumentVersion.objects.filter(document=document).delete()
    Document.objects.filter(pk=document.pk).delete()
    workspace.delete()
    User.objects.filter(pk=author.pk).delete()


class TestConcurrentVersionNumbering:
    def test_simultaneous_edits_do_not_collide(self, concurrent_document: Any) -> None:
        """
        Six writers, one document, no duplicate-key error.

        Without the `select_for_update` in `update_document`, several of these
        read the same MAX and at least one dies on the unique constraint.
        """
        document = concurrent_document
        author = document.created_by

        def edit(index: int) -> None:
            services.update_document(
                document=Document.objects.get(pk=document.pk),
                editor=author,
                content=f"<p>edit {index}</p>",
            )

        errors = run_concurrently(edit, THREADS)

        assert errors == [], f"concurrent edits raised: {errors!r}"

    def test_every_edit_produced_exactly_one_version(
        self, concurrent_document: Any
    ) -> None:
        document = concurrent_document
        author = document.created_by

        def edit(index: int) -> None:
            services.update_document(
                document=Document.objects.get(pk=document.pk),
                editor=author,
                content=f"<p>edit {index}</p>",
            )

        run_concurrently(edit, THREADS)

        # v1 from creation, plus one per writer.
        assert document.versions.count() == THREADS + 1

    def test_version_numbers_are_a_contiguous_sequence(
        self, concurrent_document: Any
    ) -> None:
        """
        No gaps and no duplicates.

        A gap would mean a version was rolled back after taking a number; a
        duplicate is impossible while the constraint holds, so the real check
        here is that nothing was silently lost.
        """
        document = concurrent_document
        author = document.created_by

        def edit(index: int) -> None:
            services.update_document(
                document=Document.objects.get(pk=document.pk),
                editor=author,
                content=f"<p>edit {index}</p>",
            )

        run_concurrently(edit, THREADS)

        numbers = sorted(document.versions.values_list("version_number", flat=True))

        assert numbers == list(range(1, THREADS + 2))
        assert len(numbers) == len(set(numbers))

    def test_concurrent_restores_do_not_collide(self, concurrent_document: Any) -> None:
        """Restore takes the same lock, so it serialises with edits and itself."""
        document = concurrent_document
        author = document.created_by
        first = document.versions.get(version_number=1)

        def restore(index: int) -> None:
            services.restore_version(
                document=Document.objects.get(pk=document.pk),
                version=DocumentVersion.objects.get(pk=first.pk),
                actor=author,
            )

        errors = run_concurrently(restore, THREADS)

        assert errors == []
        numbers = sorted(document.versions.values_list("version_number", flat=True))
        assert numbers == list(range(1, THREADS + 2))

    def test_the_document_revision_matches_the_version_count(
        self, concurrent_document: Any
    ) -> None:
        """
        A lost update would show up here as a revision lower than the number of
        versions written.
        """
        document = concurrent_document
        author = document.created_by

        def edit(index: int) -> None:
            services.update_document(
                document=Document.objects.get(pk=document.pk),
                editor=author,
                content=f"<p>edit {index}</p>",
            )

        run_concurrently(edit, THREADS)

        document.refresh_from_db()
        assert document.revision == THREADS + 1
