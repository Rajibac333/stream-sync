"""
Cross-cutting building blocks shared by every app.

`common` deliberately depends on nothing under `apps/`. The dependency runs one
way — apps import from common — which keeps this package free of the circular
imports that appear when shared code starts reaching back into features.
"""
