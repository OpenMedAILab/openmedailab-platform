from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="api_health"),
    path("csrf/", views.csrf, name="api_csrf"),
    path("meta/", views.meta, name="api_meta"),
    path("me/", views.me, name="api_me"),
    path("me/profile/", views.profile, name="api_profile"),
    path("me/dashboard/", views.dashboard, name="api_dashboard"),
    path("auth/register/", views.register, name="api_register"),
    path("auth/login/", views.login_view, name="api_login"),
    path("auth/logout/", views.logout_view, name="api_logout"),
    path("projects/", views.project_list, name="api_project_list"),
    path("projects/<int:pk>/", views.project_detail, name="api_project_detail"),
    path("projects/<int:pk>/follow/", views.follow_project, name="api_project_follow"),
    path("projects/<int:pk>/unfollow/", views.unfollow_project, name="api_project_unfollow"),
    path("projects/<int:pk>/score/", views.score_project, name="api_project_score"),
    path("projects/<int:pk>/interest/", views.interest_project, name="api_project_interest"),
    path("projects/<int:pk>/claim/", views.claim_project, name="api_project_claim"),
    path("projects/<int:pk>/sponsor/", views.sponsor_project, name="api_project_sponsor"),
]
