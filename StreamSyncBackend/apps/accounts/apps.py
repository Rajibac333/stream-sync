from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    # Without this, Django would label the app "apps.accounts" and the user
    # table would be named accordingly. "accounts" keeps AUTH_USER_MODEL and
    # every future migration reference short and stable.
    label = "accounts"
    verbose_name = "Accounts"
