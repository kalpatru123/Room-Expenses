import secrets
import string
from django.db import models
from django.conf import settings


def generate_unique_invite_code():
    chars = string.ascii_uppercase + string.digits
    # Exclude confusing characters like O, 0, I, 1
    chars = ''.join(c for c in chars if c not in 'O0I1')
    return ''.join(secrets.choice(chars) for _ in range(8))


class Room(models.Model):
    name = models.CharField(max_length=120, verbose_name="Room Name")
    description = models.TextField(blank=True, verbose_name="Room Description")
    invite_code = models.CharField(
        max_length=12,
        unique=True,
        db_index=True,
        default=generate_unique_invite_code,
        verbose_name="Invite Code"
    )
    currency = models.CharField(max_length=5, default='₹', verbose_name="Currency Symbol")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='created_rooms',
        verbose_name="Created By"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name

    def regenerate_invite_code(self):
        code = generate_unique_invite_code()
        while Room.objects.filter(invite_code=code).exists():
            code = generate_unique_invite_code()
        self.invite_code = code
        self.save(update_fields=['invite_code'])
        return self.invite_code


class RoomMember(models.Model):
    ROLE_CHOICES = (
        ('ADMIN', 'Admin'),
        ('MEMBER', 'Member'),
    )

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='members')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='room_memberships')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='MEMBER')
    joined_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ('room', 'user')
        ordering = ['-joined_at']

    def __str__(self):
        return f"{self.user.get_display_name()} ({self.get_role_display()}) in {self.room.name}"
