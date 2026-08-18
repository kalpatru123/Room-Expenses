from django.urls import path
from .views import (
    RoomListCreateAPIView,
    RoomDetailAPIView,
    JoinRoomAPIView,
    RegenerateInviteCodeAPIView,
    RoomMembersAPIView,
    RoomBalancesAPIView,
    RoomAnalyticsAPIView,
    dashboard_view,
    rooms_list_view,
    room_detail_view,
    create_join_room_view
)

urlpatterns = [
    # Frontend Pages
    path('', dashboard_view, name='dashboard-page'),
    path('rooms/', rooms_list_view, name='rooms-page'),
    path('rooms/create-join/', create_join_room_view, name='create-join-room-page'),
    path('rooms/<int:pk>/', room_detail_view, name='room-detail-page'),

    # REST APIs
    path('api/rooms/', RoomListCreateAPIView.as_view(), name='api-room-list-create'),
    path('api/rooms/join/', JoinRoomAPIView.as_view(), name='api-room-join'),
    path('api/rooms/<int:pk>/', RoomDetailAPIView.as_view(), name='api-room-detail'),
    path('api/rooms/<int:pk>/regenerate-invite/', RegenerateInviteCodeAPIView.as_view(), name='api-room-regenerate-invite'),
    path('api/rooms/<int:pk>/members/', RoomMembersAPIView.as_view(), name='api-room-members'),
    path('api/rooms/<int:pk>/members/<int:user_id>/', RoomMembersAPIView.as_view(), name='api-room-member-remove'),
    path('api/rooms/<int:pk>/balances/', RoomBalancesAPIView.as_view(), name='api-room-balances'),
    path('api/rooms/<int:pk>/analytics/', RoomAnalyticsAPIView.as_view(), name='api-room-analytics'),
]
