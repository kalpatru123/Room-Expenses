from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

User = get_user_model()


class AccountsAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.register_url = '/api/auth/register/'
        self.token_url = '/api/auth/token/'
        self.profile_url = '/api/auth/profile/'

    def test_user_registration_success(self):
        payload = {
            'username': 'john_doe',
            'email': 'john@example.com',
            'first_name': 'John',
            'last_name': 'Doe',
            'password': 'SecurePassword123!',
            'password_confirm': 'SecurePassword123!',
        }
        response = self.client.post(self.register_url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertEqual(response.data['user']['username'], 'john_doe')
        self.assertEqual(response.data['user']['display_name'], 'John Doe')

    def test_user_registration_password_mismatch(self):
        payload = {
            'username': 'jane_doe',
            'email': 'jane@example.com',
            'password': 'password123',
            'password_confirm': 'password999',
        }
        response = self.client.post(self.register_url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_jwt_token_login_and_profile_access(self):
        user = User.objects.create_user(
            username='sammy',
            email='sammy@example.com',
            password='mypassword123',
            first_name='Sammy'
        )

        # Login to obtain JWT
        token_res = self.client.post(self.token_url, {
            'username': 'sammy',
            'password': 'mypassword123'
        }, format='json')
        self.assertEqual(token_res.status_code, status.HTTP_200_OK)
        access_token = token_res.data['access']

        # Access Profile with JWT
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
        profile_res = self.client.get(self.profile_url)
        self.assertEqual(profile_res.status_code, status.HTTP_200_OK)
        self.assertEqual(profile_res.data['username'], 'sammy')

    def test_frontend_templates_render(self):
        pages = ['/login/', '/register/', '/profile/', '/', '/rooms/', '/rooms/create-join/', '/expenses/', '/settlements/']
        for p in pages:
            res = self.client.get(p)
            self.assertEqual(res.status_code, status.HTTP_200_OK, f"Page {p} failed to render")

