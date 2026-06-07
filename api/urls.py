from django.urls import path

from .ninja_api import api

urlpatterns = [
    path("", api.urls),
]
