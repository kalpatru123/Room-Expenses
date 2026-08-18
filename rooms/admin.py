from django.contrib import admin
from .models import Room, RoomMember


class RoomMemberInline(admin.TabularInline):
    model = RoomMember
    extra = 1


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('name', 'invite_code', 'currency', 'created_by', 'created_at')
    search_fields = ('name', 'invite_code', 'created_by__username', 'created_by__email')
    inlines = [RoomMemberInline]


@admin.register(RoomMember)
class RoomMemberAdmin(admin.ModelAdmin):
    list_display = ('room', 'user', 'role', 'joined_at', 'is_active')
    list_filter = ('role', 'is_active')
    search_fields = ('room__name', 'user__username', 'user__email')
