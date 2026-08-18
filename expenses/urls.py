from django.urls import path
from .views import (
    CategoryListCreateAPIView,
    ExpenseListCreateAPIView,
    ExpenseDetailAPIView,
    SettlementListCreateAPIView,
    SettlementDetailAPIView,
    SettlementVerifyAPIView,
    SettlementRejectAPIView,
    SettlementMarkPaidAPIView,
    expenses_list_view,
    settlements_list_view
)

urlpatterns = [
    # Frontend Pages
    path('expenses/', expenses_list_view, name='expenses-page'),
    path('settlements/', settlements_list_view, name='settlements-page'),

    # REST APIs
    path('api/categories/', CategoryListCreateAPIView.as_view(), name='api-category-list-create'),
    path('api/expenses/', ExpenseListCreateAPIView.as_view(), name='api-expense-list-create'),
    path('api/expenses/<int:pk>/', ExpenseDetailAPIView.as_view(), name='api-expense-detail'),
    path('api/settlements/', SettlementListCreateAPIView.as_view(), name='api-settlement-list-create'),
    path('api/settlements/<int:pk>/', SettlementDetailAPIView.as_view(), name='api-settlement-detail'),
    path('api/settlements/<int:pk>/verify/', SettlementVerifyAPIView.as_view(), name='api-settlement-verify'),
    path('api/settlements/<int:pk>/reject/', SettlementRejectAPIView.as_view(), name='api-settlement-reject'),
    path('api/settlements/<int:pk>/mark-paid/', SettlementMarkPaidAPIView.as_view(), name='api-settlement-mark-paid'),
]
