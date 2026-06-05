from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("dashboard/", views.dashboard, name="dashboard"),
    path("projects/", views.project_list, name="project_list"),
    path("projects/<int:pk>/", views.project_detail, name="project_detail"),
    path("projects/<int:pk>/follow/", views.follow_project, name="project_follow"),
    path("projects/<int:pk>/unfollow/", views.unfollow_project, name="project_unfollow"),
    path("projects/<int:pk>/score/", views.score_project, name="project_score"),
    path("projects/<int:pk>/interest/", views.interest_project, name="project_interest"),
    path("projects/<int:pk>/claim/", views.claim_project, name="project_claim"),
    path("projects/<int:pk>/sponsor/", views.sponsor_project, name="project_sponsor"),
]
