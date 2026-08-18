from django.contrib import admin
from .models import Category, Expense, ExpenseSplit, Settlement


class ExpenseSplitInline(admin.TabularInline):
    model = ExpenseSplit
    extra = 1


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'icon', 'color', 'room', 'created_at')
    search_fields = ('name',)


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ('title', 'room', 'amount', 'category', 'paid_by', 'split_type', 'date')
    list_filter = ('room', 'split_type', 'category', 'date')
    search_fields = ('title', 'notes', 'paid_by__username')
    inlines = [ExpenseSplitInline]


@admin.register(ExpenseSplit)
class ExpenseSplitAdmin(admin.ModelAdmin):
    list_display = ('expense', 'user', 'amount', 'percentage', 'is_settled')
    list_filter = ('is_settled',)


@admin.register(Settlement)
class SettlementAdmin(admin.ModelAdmin):
    list_display = ('room', 'payer', 'payee', 'amount', 'status', 'created_at', 'completed_at')
    list_filter = ('room', 'status', 'created_at')
    search_fields = ('payer__username', 'payee__username', 'notes')
