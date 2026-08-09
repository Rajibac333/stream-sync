#!/bin/bash
# Stop at the first failure — a build that "succeeds" after a step actually
# failed (e.g. migrate erroring but collectstatic still running) is worse
# than a build that fails loudly where it broke.
set -o errexit

pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
