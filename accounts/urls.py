from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .views import (
    RegisterAPIView,
    UserProfileAPIView,
    UserSearchAPIView,
    login_view,
    register_view,
    profile_view,
    logout_view
)

urlpatterns = [
    # Frontend Pages
    path('login/', login_view, name='login-page'),
    path('register/', register_view, name='register-page'),
    path('profile/', profile_view, name='profile-page'),
    path('logout/', logout_view, name='logout-page'),

    # REST APIs
    path('api/auth/register/', RegisterAPIView.as_view(), name='api-register'),
    path('api/auth/token/', TokenObtainPairView.as_view(), name='api-token-obtain'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='api-token-refresh'),
    path('api/auth/profile/', UserProfileAPIView.as_view(), name='api-profile'),
    path('api/auth/users/search/', UserSearchAPIView.as_view(), name='api-user-search'),
]
