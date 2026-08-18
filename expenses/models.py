from decimal import Decimal
from django.db import models
from django.conf import settings
from django.utils import timezone
from rooms.models import Room


class Category(models.Model):
    name = models.CharField(max_length=60, verbose_name="Category Name")
    icon = models.CharField(max_length=50, default='bi-tag', verbose_name="Bootstrap Icon Class")
    color = models.CharField(max_length=20, default='#4F46E5', verbose_name="Badge Color")
    room = models.ForeignKey(
        Room,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='custom_categories',
        verbose_name="Room (Optional)"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ['name']

    def __str__(self):
        return self.name


class Expense(models.Model):
    SPLIT_TYPE_CHOICES = (
        ('EQUAL', 'Split Equally'),
        ('CUSTOM', 'Custom Exact Amounts'),
        ('PERCENTAGE', 'Split By Percentage'),
    )

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='expenses')
    title = models.CharField(max_length=200, verbose_name="Expense Title")
    amount = models.DecimalField(max_digits=12, decimal_places=2, verbose_name="Total Amount")
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='expenses'
    )
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='paid_expenses',
        verbose_name="Paid By"
    )
    split_type = models.CharField(
        max_length=15,
        choices=SPLIT_TYPE_CHOICES,
        default='EQUAL',
        verbose_name="Split Type"
    )
    date = models.DateField(default=timezone.now, verbose_name="Expense Date")
    notes = models.TextField(blank=True, verbose_name="Notes / Description")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']

    def __str__(self):
        return f"{self.title} - {self.room.currency}{self.amount} ({self.room.name})"


class ExpenseSplit(models.Model):
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name='splits')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='expense_splits'
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2, verbose_name="Share Amount")
    percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Share Percentage"
    )
    is_settled = models.BooleanField(default=False)

    class Meta:
        unique_together = ('expense', 'user')
        ordering = ['user__first_name', 'user__username']

    def __str__(self):
        return f"{self.user.get_display_name()} owes {self.amount} for {self.expense.title}"


class Settlement(models.Model):
    STATUS_CHOICES = (
        ('PENDING', 'Pending Verification'),
        ('COMPLETED', 'Completed / Verified'),
        ('REJECTED', 'Rejected'),
    )

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='settlements')
    payer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='settlements_paid',
        verbose_name="Payer (Who Paid)"
    )
    payee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='settlements_received',
        verbose_name="Payee (Who Received)"
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2, verbose_name="Settlement Amount")
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='PENDING')
    notes = models.TextField(blank=True, verbose_name="Settlement Note / Reference")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='created_settlements'
    )
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_settlements',
        verbose_name="Verified By"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.payer.get_display_name()} -> {self.payee.get_display_name()} ({self.amount}) [{self.status}]"

    def mark_completed(self, user=None):
        self.status = 'COMPLETED'
        self.completed_at = timezone.now()
        if user:
            self.verified_by = user
        self.save(update_fields=['status', 'completed_at', 'verified_by'])

    def verify(self, user):
        if user.id != self.payee_id:
            raise ValueError("Only the recipient (payee) can verify this payment.")
        self.status = 'COMPLETED'
        self.completed_at = timezone.now()
        self.verified_by = user
        self.save(update_fields=['status', 'completed_at', 'verified_by'])

    def reject(self, user):
        if user.id not in [self.payee_id, self.payer_id, self.room.created_by_id]:
            raise ValueError("You do not have permission to reject or cancel this settlement.")
        self.status = 'REJECTED'
        self.rejected_at = timezone.now()
        self.save(update_fields=['status', 'rejected_at'])


class SettlementEditHistory(models.Model):
    settlement = models.ForeignKey(Settlement, on_delete=models.CASCADE, related_name='edit_history')
    edited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='settlement_edits')
    previous_amount = models.DecimalField(max_digits=12, decimal_places=2)
    new_amount = models.DecimalField(max_digits=12, decimal_places=2)
    previous_notes = models.TextField(blank=True)
    new_notes = models.TextField(blank=True)
    previous_payer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    new_payer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    previous_payee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    new_payee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    edited_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-edited_at']
        verbose_name_plural = "Settlement Edit Histories"

    def __str__(self):
        return f"Settlement #{self.settlement_id} edited by {self.edited_by.get_display_name()} on {self.edited_at}"
