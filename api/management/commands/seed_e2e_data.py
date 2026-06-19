import json
import os
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import RoleType
from interactions.models import (
    AuthorshipIntent,
    ClaimType,
    InteractionStatus,
    ProjectClaimIntent,
    ProjectFollow,
    ProjectInterest,
    ProjectScore,
    SponsorIntent,
    SponsorType,
)
from projects.models import Project, ProjectStage, Tag, Theme


PASSWORD = "StrongPass12345"
ROOT = Path(__file__).resolve().parents[3]
FIXTURE_PATH = ROOT / "frontend" / "e2e" / ".state" / "fixture.json"


class Command(BaseCommand):
    help = "Seed deterministic data for Playwright E2E."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Recreate only namespaced E2E records.")

    def handle(self, *args, **options):
        if os.environ.get("OPENMEDAILAB_E2E") != "1":
            raise CommandError("seed_e2e_data requires OPENMEDAILAB_E2E=1")

        with transaction.atomic():
            if options["reset"]:
                self.reset_namespaced_records()

            call_command(
                "ensure_platform_admin",
                username="platform_admin",
                email="platform_admin_e2e@example.com",
                password=PASSWORD,
                verbosity=0,
            )
            admin = User.objects.get(username="platform_admin")
            admin.profile.must_change_password = False
            admin.profile.save(update_fields=["must_change_password", "updated_at"])

            owner = self.user("e2e_owner", RoleType.PHD_OR_ABOVE, "E2E 课题创建者", "owner-wechat")
            participant = self.user("e2e_participant", RoleType.UNDERGRAD_OR_BELOW, "E2E 参与者", "participant-wechat")
            extra_student = self.user("e2e_extra_student", RoleType.UNDERGRAD_OR_BELOW, "E2E 额外学生", "extra-student-wechat")
            claimant = self.user("e2e_claimant", RoleType.PHD_OR_ABOVE, "E2E 认领者", "claimant-wechat")
            sponsor = self.user("e2e_sponsor", RoleType.ENGINEER, "E2E 资助者", "sponsor-wechat")
            occupied = self.user("e2e_occupied", RoleType.PHD_OR_ABOVE, "E2E 已占用负责人", "occupied-wechat")

            theme, _ = Theme.objects.update_or_create(
                slug="e2e-ophthalmology",
                defaults={
                    "name": "E2E 眼前节",
                    "description": "Playwright E2E fixture theme",
                    "sort_order": 9990,
                    "is_active": True,
                },
            )
            tag, _ = Tag.objects.update_or_create(name="E2E_RAG", defaults={"slug": "e2e-rag"})

            public_project = self.project(
                topic_id=9901,
                title="E2E_PUBLIC_OPEN 可提交协作课题",
                stage=ProjectStage.OPEN_RECRUITING,
                owner=owner,
                theme=theme,
            )
            with_relations = self.project(
                topic_id=9902,
                title="E2E_PUBLIC_WITH_RELATIONS 本人关系课题",
                stage=ProjectStage.TEAM_BUILDING,
                owner=owner,
                theme=theme,
            )
            claim_pending = self.project(
                topic_id=9903,
                title="E2E_CLAIM_PENDING 审批中文字课题",
                stage=ProjectStage.OPEN_RECRUITING,
                owner=owner,
                theme=theme,
            )
            claim_occupied = self.project(
                topic_id=9904,
                title="E2E_CLAIM_OCCUPIED 席位已占用课题",
                stage=ProjectStage.OPEN_RECRUITING,
                owner=owner,
                theme=theme,
            )
            stage_blocked = self.project(
                topic_id=9905,
                title="E2E_STAGE_BLOCKED 不可招募课题",
                stage=ProjectStage.ACTIVE,
                owner=owner,
                theme=theme,
            )
            rejected_application = self.project(
                topic_id=9906,
                title="E2E_REJECTED_APPLICATION 可重新提交课题",
                stage=ProjectStage.OPEN_RECRUITING,
                owner=owner,
                theme=theme,
            )

            for project in [public_project, with_relations, claim_pending, claim_occupied, stage_blocked, rejected_application]:
                project.tags.set([tag])

            ProjectInterest.objects.update_or_create(
                user=participant,
                project=with_relations,
                role="学生",
                defaults={
                    "status": InteractionStatus.APPROVED,
                    "available_hours_per_week": 6,
                    "authorship_intention": AuthorshipIntent.CONTRIBUTION,
                    "message": "E2E approved participation",
                },
            )
            ProjectInterest.objects.update_or_create(
                user=extra_student,
                project=with_relations,
                role="学生",
                defaults={
                    "status": InteractionStatus.APPROVED,
                    "available_hours_per_week": 5,
                    "authorship_intention": AuthorshipIntent.CONTRIBUTION,
                    "message": "E2E approved extra student participation",
                },
            )
            ProjectInterest.objects.update_or_create(
                user=owner,
                project=with_relations,
                role="医生",
                defaults={"status": InteractionStatus.APPROVED, "available_hours_per_week": 4},
            )
            ProjectClaimIntent.objects.update_or_create(
                user=participant,
                project=with_relations,
                claim_type=ClaimType.LEADER,
                defaults={"status": InteractionStatus.APPROVED, "message": "E2E approved leader"},
            )
            SponsorIntent.objects.update_or_create(
                user=participant,
                project=with_relations,
                sponsor_type=SponsorType.COMPUTE,
                defaults={"status": InteractionStatus.APPROVED, "note": "E2E approved compute"},
            )
            ProjectFollow.objects.get_or_create(user=participant, project=with_relations)
            ProjectScore.objects.update_or_create(
                user=participant,
                project=with_relations,
                defaults={"score": 10, "comment": "E2E like"},
            )

            ProjectClaimIntent.objects.update_or_create(
                user=claimant,
                project=claim_pending,
                claim_type=ClaimType.LEADER,
                defaults={"status": InteractionStatus.PENDING, "message": "E2E pending leader"},
            )
            ProjectClaimIntent.objects.update_or_create(
                user=claimant,
                project=claim_pending,
                claim_type=ClaimType.PAPER_FIRST_UNIT,
                defaults={
                    "status": InteractionStatus.PENDING,
                    "claimed_unit_name": "E2E 第一单位",
                    "message": "E2E pending first unit",
                },
            )
            ProjectClaimIntent.objects.update_or_create(
                user=occupied,
                project=claim_occupied,
                claim_type=ClaimType.LEADER,
                defaults={"status": InteractionStatus.APPROVED, "message": "E2E occupied leader"},
            )
            ProjectClaimIntent.objects.update_or_create(
                user=claimant,
                project=rejected_application,
                claim_type=ClaimType.LEADER,
                defaults={
                    "status": InteractionStatus.REJECTED,
                    "message": "E2E rejected leader message",
                    "review_comment": "请补充项目负责人职责说明",
                    "reviewed_by": admin,
                    "reviewed_at": timezone.now(),
                },
            )
            ProjectClaimIntent.objects.update_or_create(
                user=claimant,
                project=rejected_application,
                claim_type=ClaimType.PAPER_FIRST_UNIT,
                defaults={
                    "status": InteractionStatus.REJECTED,
                    "claimed_unit_name": "E2E 被驳回第一单位",
                    "message": "E2E rejected first unit message",
                    "review_comment": "请补充第一单位认领依据",
                    "reviewed_by": admin,
                    "reviewed_at": timezone.now(),
                },
            )
            SponsorIntent.objects.update_or_create(
                user=sponsor,
                project=rejected_application,
                sponsor_type=SponsorType.TOKEN,
                defaults={
                    "status": InteractionStatus.REJECTED,
                    "note": "E2E rejected token note",
                    "review_comment": "请补充 token 额度和周期",
                    "reviewed_by": admin,
                    "reviewed_at": timezone.now(),
                },
            )

            FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
            FIXTURE_PATH.write_text(
                json.dumps(
                    {
                        "users": {
                            "participant": "e2e_participant",
                            "claimant": "e2e_claimant",
                            "sponsor": "e2e_sponsor",
                            "admin": "platform_admin",
                            "password": PASSWORD,
                        },
                        "projects": {
                            "public_id": public_project.id,
                            "public_title": public_project.title,
                            "public_topic_id": public_project.topic_id,
                            "with_relations_id": with_relations.id,
                            "with_relations_title": with_relations.title,
                            "with_relations_topic_id": with_relations.topic_id,
                            "claim_pending_id": claim_pending.id,
                            "claim_pending_title": claim_pending.title,
                            "claim_occupied_id": claim_occupied.id,
                            "claim_occupied_title": claim_occupied.title,
                            "stage_blocked_id": stage_blocked.id,
                            "rejected_application_id": rejected_application.id,
                            "rejected_application_title": rejected_application.title,
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

        self.stdout.write(self.style.SUCCESS(f"E2E fixture written to {FIXTURE_PATH}"))

    def reset_namespaced_records(self):
        Project.objects.filter(topic_id__gte=9900, title__startswith="E2E_").delete()
        Theme.objects.filter(slug__startswith="e2e-").delete()
        Tag.objects.filter(slug__startswith="e2e-").delete()
        User.objects.filter(username__startswith="e2e_").delete()

    def user(self, username, role_type, display_name, wechat):
        user, _ = User.objects.update_or_create(
            username=username,
            defaults={"email": f"{username}@example.com", "is_staff": False, "is_superuser": False},
        )
        user.set_password(PASSWORD)
        user.save()
        profile = user.profile
        profile.display_name = display_name
        profile.role_type = role_type
        profile.contact_email = user.email
        profile.email_normalized = user.email
        profile.contact_wechat = wechat
        profile.credit_balance = 500
        profile.must_change_password = False
        profile.save()
        return user

    def project(self, topic_id, title, stage, owner, theme):
        project, _ = Project.objects.update_or_create(
            topic_id=topic_id,
            defaults={
                "title": title,
                "title_en": title,
                "summary": f"{title} 摘要，用于浏览器验收。",
                "problem_statement": "E2E 科学问题",
                "clinical_endpoint": "E2E 临床终点",
                "existing_foundation": "E2E 已有基础",
                "theme": theme,
                "created_by": owner,
                "stage": stage,
                "is_public": True,
            },
        )
        return project
