from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Room, RoomMember
from accounts.serializers import UserSummarySerializer

User = get_user_model()


class RoomMemberSerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)
    role_display = serializers.CharField(source='get_role_display', read_only=True)

    class Meta:
        model = RoomMember
        fields = ('id', 'user', 'role', 'role_display', 'joined_at', 'is_active')


class RoomSerializer(serializers.ModelSerializer):
    created_by = UserSummarySerializer(read_only=True)
    members_count = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ('id', 'name', 'description', 'invite_code', 'currency', 'created_by', 'members_count', 'my_role', 'created_at', 'updated_at')
        read_only_fields = ('id', 'invite_code', 'created_by', 'created_at', 'updated_at')

    def get_members_count(self, obj):
        return obj.members.filter(is_active=True).count()

    def get_my_role(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            membership = obj.members.filter(user=request.user, is_active=True).first()
            return membership.role if membership else None
        return None


class RoomCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = ('id', 'name', 'description', 'currency', 'invite_code')
        read_only_fields = ('id', 'invite_code')

    def create(self, validated_data):
        user = self.context['request'].user
        room = Room.objects.create(created_by=user, **validated_data)
        # Add creator as ADMIN member
        RoomMember.objects.create(room=room, user=user, role='ADMIN')
        return room


class JoinRoomSerializer(serializers.Serializer):
    invite_code = serializers.CharField(max_length=12, required=True, trim_whitespace=True)

    def validate_invite_code(self, value):
        code = value.strip().upper()
        try:
            room = Room.objects.get(invite_code=code)
        except Room.DoesNotExist:
            raise serializers.ValidationError("Invalid room invite code. Please check and try again.")
        self.room = room
        return code

    def validate(self, attrs):
        user = self.context['request'].user
        room = getattr(self, 'room', None)
        if room:
            membership = RoomMember.objects.filter(room=room, user=user).first()
            if membership and membership.is_active:
                raise serializers.ValidationError({"invite_code": "You are already an active member of this room."})
        return attrs
