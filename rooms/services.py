import calendar
import datetime
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
from django.db.models import Sum, Count
from django.utils import timezone
from accounts.serializers import UserSummarySerializer


def round_curr(amount):
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    return amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def calculate_room_balances(room, year=None, month=None):
    """
    Computes accurate balances for all members in a room (all time or for a specific month)
    and generates simplified debt settlements using a greedy min-cash-flow algorithm.
    """
    members = room.members.filter(is_active=True).select_related('user')
    member_map = {m.user.id: m.user for m in members}
    today = timezone.now().date()
    
    # 0. Find all available months in this room's expenses
    available_months_qs = (
        room.expenses.all()
        .dates('date', 'month', order='DESC')
    )
    
    available_months = []
    curr_month_key = f"{today.year}-{today.month:02d}"
    curr_month_label = today.strftime('%B %Y')
    
    found_keys = set()
    for d in available_months_qs:
        m_key = f"{d.year}-{d.month:02d}"
        if m_key not in found_keys:
            found_keys.add(m_key)
            last_day = calendar.monthrange(d.year, d.month)[1]
            last_date = datetime.date(d.year, d.month, last_day)
            available_months.append({
                'key': m_key,
                'year': d.year,
                'month': d.month,
                'label': d.strftime('%B %Y'),
                'short_label': d.strftime('%b %Y'),
                'is_completed': last_date < today,
                'last_day_formatted': last_date.strftime('%d/%m/%Y'),
                'is_current': (d.year == today.year and d.month == today.month)
            })
            
    if curr_month_key not in found_keys:
        last_day = calendar.monthrange(today.year, today.month)[1]
        last_date = datetime.date(today.year, today.month, last_day)
        available_months.insert(0, {
            'key': curr_month_key,
            'year': today.year,
            'month': today.month,
            'label': curr_month_label,
            'short_label': today.strftime('%b %Y'),
            'is_completed': False,
            'last_day_formatted': last_date.strftime('%d/%m/%Y'),
            'is_current': True
        })

    # Sort available_months descending (newest first)
    available_months.sort(key=lambda x: x['key'], reverse=True)

    selected_period_label = "All Time"
    if year and month:
        selected_period_label = datetime.date(year, month, 1).strftime('%B %Y')

    if not member_map:
        return {
            'total_room_expenses': Decimal('0.00'),
            'total_expenses_count': 0,
            'member_balances': [],
            'simplified_debts': [],
            'available_months': available_months,
            'selected_month': f"{year}-{month:02d}" if year and month else None,
            'selected_period_label': selected_period_label
        }

    # Tracking per user
    total_paid = defaultdict(lambda: Decimal('0.00'))
    total_share = defaultdict(lambda: Decimal('0.00'))
    settlements_paid = defaultdict(lambda: Decimal('0.00'))
    settlements_received = defaultdict(lambda: Decimal('0.00'))

    # 1. Total expenses in room (optionally filtered by month)
    expenses = room.expenses.all().prefetch_related('splits')
    settlements_qs = room.settlements.filter(status='COMPLETED')

    if year and month:
        expenses = expenses.filter(date__year=year, date__month=month)
        settlements_qs = settlements_qs.filter(created_at__year=year, created_at__month=month)

    total_room_expenses = Decimal('0.00')

    for exp in expenses:
        total_room_expenses += exp.amount
        total_paid[exp.paid_by_id] += exp.amount
        for split in exp.splits.all():
            total_share[split.user_id] += split.amount

    # 2. Completed settlements in room
    for st in settlements_qs:
        settlements_paid[st.payer_id] += st.amount
        settlements_received[st.payee_id] += st.amount

    # 3. Calculate net balance for each member
    # Net Balance = (Paid for Expenses + Paid in Settlements) - (Share in Expenses + Received in Settlements)
    member_balances = []
    net_balances = {}

    for member in members:
        uid = member.user.id
        u_paid = round_curr(total_paid[uid])
        u_share = round_curr(total_share[uid])
        u_st_paid = round_curr(settlements_paid[uid])
        u_st_recv = round_curr(settlements_received[uid])
        
        # Net balance
        net = round_curr((u_paid + u_st_paid) - (u_share + u_st_recv))
        net_balances[uid] = net

        status_text = "settled"
        if net > Decimal('0.00'):
            status_text = "gets_back"
        elif net < Decimal('0.00'):
            status_text = "owes"

        member_balances.append({
            'user': UserSummarySerializer(member.user).data,
            'role': member.role,
            'total_paid': float(u_paid),
            'total_share': float(u_share),
            'settlements_paid': float(u_st_paid),
            'settlements_received': float(u_st_recv),
            'net_balance': float(net),
            'status': status_text,
            'joined_at': member.joined_at.isoformat() if member.joined_at else None
        })

    # 4. Debt Simplification Algorithm (Min Cash Flow)
    debtors = []   # list of [user_id, amount_owed] (positive number)
    creditors = [] # list of [user_id, amount_to_receive] (positive number)

    for uid, net in net_balances.items():
        if net < Decimal('-0.005'):
            debtors.append([uid, -net])
        elif net > Decimal('0.005'):
            creditors.append([uid, net])

    simplified_debts = []

    # Sort largest debtors and creditors first to minimize number of transfers
    while debtors and creditors:
        debtors.sort(key=lambda x: x[1], reverse=True)
        creditors.sort(key=lambda x: x[1], reverse=True)

        debtor_id, debt_amount = debtors[0]
        creditor_id, credit_amount = creditors[0]

        transfer_amount = min(debt_amount, credit_amount)
        transfer_amount_rounded = round_curr(transfer_amount)

        if transfer_amount_rounded > Decimal('0.00'):
            simplified_debts.append({
                'from_user': UserSummarySerializer(member_map[debtor_id]).data,
                'to_user': UserSummarySerializer(member_map[creditor_id]).data,
                'amount': float(transfer_amount_rounded)
            })

        # Update remaining amounts
        debtors[0][1] -= transfer_amount
        creditors[0][1] -= transfer_amount

        if debtors[0][1] <= Decimal('0.005'):
            debtors.pop(0)
        if creditors[0][1] <= Decimal('0.005'):
            creditors.pop(0)

    return {
        'total_room_expenses': float(round_curr(total_room_expenses)),
        'total_expenses_count': expenses.count(),
        'member_balances': member_balances,
        'simplified_debts': simplified_debts,
        'available_months': available_months,
        'selected_month': f"{year}-{month:02d}" if year and month else None,
        'selected_period_label': selected_period_label
    }


def get_room_analytics(room, year=None, month=None):
    """
    Computes category breakdown, monthly spending trends, and month-over-month differences for Chart.js.
    """
    today = timezone.now().date()
    all_expenses = room.expenses.all().select_related('category')
    
    # Filter expenses for category chart if specific month requested
    filtered_expenses = all_expenses
    if year and month:
        filtered_expenses = all_expenses.filter(date__year=year, date__month=month)

    # 1. Category breakdown (for the selected month or all-time)
    category_totals = defaultdict(Decimal)
    category_meta = {}
    total_amount = Decimal('0.00')

    for exp in filtered_expenses:
        total_amount += exp.amount
        cat_name = exp.category.name if exp.category else 'General'
        cat_color = exp.category.color if exp.category else '#6B7280'
        cat_icon = exp.category.icon if exp.category else 'bi-tag'
        category_totals[cat_name] += exp.amount
        category_meta[cat_name] = {'color': cat_color, 'icon': cat_icon}

    category_chart_data = {
        'labels': [],
        'data': [],
        'colors': [],
        'percentages': []
    }

    for cat_name, cat_amt in category_totals.items():
        rounded_amt = float(round_curr(cat_amt))
        percentage = round((float(cat_amt) / float(total_amount) * 100), 1) if total_amount > 0 else 0
        category_chart_data['labels'].append(cat_name)
        category_chart_data['data'].append(rounded_amt)
        category_chart_data['colors'].append(category_meta[cat_name]['color'])
        category_chart_data['percentages'].append(percentage)

    # 2. Month-over-Month Expense Tracking & Difference Analysis
    # Group all expenses by year-month
    monthly_groups = defaultdict(lambda: {
        'total': Decimal('0.00'),
        'count': 0,
        'categories': defaultdict(Decimal)
    })

    for exp in all_expenses:
        exp_date = exp.date if exp.date else exp.created_at.date()
        m_key = (exp_date.year, exp_date.month)
        monthly_groups[m_key]['total'] += exp.amount
        monthly_groups[m_key]['count'] += 1
        cat_name = exp.category.name if exp.category else 'General'
        monthly_groups[m_key]['categories'][cat_name] += exp.amount

    # Ensure current month is represented even if 0 expenses
    curr_key = (today.year, today.month)
    if curr_key not in monthly_groups:
        monthly_groups[curr_key]['total'] = Decimal('0.00')
        monthly_groups[curr_key]['count'] = 0

    # Sort months chronologically
    sorted_month_keys = sorted(monthly_groups.keys())

    # Build detailed month comparison records
    monthly_comparison = []
    prev_total = None

    for (m_yr, m_mo) in sorted_month_keys:
        info = monthly_groups[(m_yr, m_mo)]
        spent = float(round_curr(info['total']))
        last_day = calendar.monthrange(m_yr, m_mo)[1]
        last_date = datetime.date(m_yr, m_mo, last_day)
        is_completed = (last_date < today)
        month_dt = datetime.date(m_yr, m_mo, 1)

        diff_amount = 0.0
        diff_pct = 0.0
        diff_dir = 'neutral'

        if prev_total is not None:
            diff_amount = round(spent - prev_total, 2)
            if prev_total > 0:
                diff_pct = round(((spent - prev_total) / prev_total) * 100, 1)
            elif spent > 0:
                diff_pct = 100.0
            
            if diff_amount > 0.01:
                diff_dir = 'increased'
            elif diff_amount < -0.01:
                diff_dir = 'decreased'
            else:
                diff_dir = 'equal'

        # Top category
        top_cat = 'General'
        top_cat_amt = 0.0
        if info['categories']:
            top_cat = max(info['categories'].items(), key=lambda x: x[1])[0]
            top_cat_amt = float(round_curr(info['categories'][top_cat]))

        # Daily average
        days_in_month = last_day
        if m_yr == today.year and m_mo == today.month:
            days_elapsed = max(today.day, 1)
            daily_avg = round(spent / days_elapsed, 2)
        else:
            daily_avg = round(spent / days_in_month, 2)

        monthly_comparison.append({
            'key': f"{m_yr}-{m_mo:02d}",
            'year': m_yr,
            'month': m_mo,
            'label': month_dt.strftime('%B %Y'),
            'short_label': month_dt.strftime('%b %Y'),
            'last_day_formatted': last_date.strftime('%d/%m/%Y'),
            'is_completed': is_completed,
            'status_badge': 'Completed Month' if is_completed else 'Active (Current)',
            'total_spent': spent,
            'expense_count': info['count'],
            'diff_amount': diff_amount,
            'diff_percentage': diff_pct,
            'diff_direction': diff_dir,
            'previous_month_spent': prev_total,
            'top_category': top_cat,
            'top_category_amount': top_cat_amt,
            'daily_average': daily_avg
        })

        prev_total = spent

    # 3. Monthly Chart Data for Chart.js
    monthly_chart = {
        'labels': [m['short_label'] for m in monthly_comparison],
        'data': [m['total_spent'] for m in monthly_comparison],
        'diff_data': [m['diff_amount'] for m in monthly_comparison],
        'diff_percentage': [m['diff_percentage'] for m in monthly_comparison],
        'is_completed': [m['is_completed'] for m in monthly_comparison],
        'comparison': monthly_comparison
    }

    # 4. Member spending vs consumption for selected month or all-time
    balances = calculate_room_balances(room, year=year, month=month)
    member_labels = [m['user']['display_name'] for m in balances['member_balances']]
    member_paid = [m['total_paid'] for m in balances['member_balances']]
    member_share = [m['total_share'] for m in balances['member_balances']]

    return {
        'total_spent': float(round_curr(total_amount)),
        'category_chart': category_chart_data,
        'monthly_chart': monthly_chart,
        'monthly_comparison': monthly_comparison,
        'member_chart': {
            'labels': member_labels,
            'paid_data': member_paid,
            'share_data': member_share
        }
    }
