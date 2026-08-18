from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
from django.db.models import Sum, Count
from django.utils import timezone
from accounts.serializers import UserSummarySerializer


def round_curr(amount):
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    return amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def calculate_room_balances(room):
    """
    Computes accurate balances for all members in a room and generates
    simplified debt settlements using a greedy min-cash-flow algorithm.
    """
    members = room.members.filter(is_active=True).select_related('user')
    member_map = {m.user.id: m.user for m in members}
    
    if not member_map:
        return {
            'total_room_expenses': Decimal('0.00'),
            'total_expenses_count': 0,
            'member_balances': [],
            'simplified_debts': []
        }

    # Tracking per user
    total_paid = defaultdict(lambda: Decimal('0.00'))
    total_share = defaultdict(lambda: Decimal('0.00'))
    settlements_paid = defaultdict(lambda: Decimal('0.00'))
    settlements_received = defaultdict(lambda: Decimal('0.00'))

    # 1. Total expenses in room
    expenses = room.expenses.all().prefetch_related('splits')
    total_room_expenses = Decimal('0.00')

    for exp in expenses:
        total_room_expenses += exp.amount
        total_paid[exp.paid_by_id] += exp.amount
        for split in exp.splits.all():
            total_share[split.user_id] += split.amount

    # 2. Completed settlements in room
    completed_settlements = room.settlements.filter(status='COMPLETED')
    for st in completed_settlements:
        settlements_paid[st.payer_id] += st.amount
        settlements_received[st.payee_id] += st.amount

    # 3. Calculate net balance for each member
    # Net Balance = (Paid for Expenses + Paid in Settlements) - (Share in Expenses + Received in Settlements)
    member_balances = []
    # net_balances dict for debt simplification: user_id -> Decimal
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
    # Debtors: net balance < 0 (they owe money)
    # Creditors: net balance > 0 (they are owed money)
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
    }


def get_room_analytics(room):
    """
    Computes category breakdown and monthly spending trends for Chart.js.
    """
    expenses = room.expenses.all().select_related('category')
    
    # 1. Category breakdown
    category_totals = defaultdict(Decimal)
    category_meta = {}
    
    total_amount = Decimal('0.00')
    for exp in expenses:
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

    # 2. Monthly Trend (last 6 months)
    monthly_data = defaultdict(Decimal)
    for exp in expenses:
        month_key = exp.date.strftime('%b %Y') if exp.date else exp.created_at.strftime('%b %Y')
        monthly_data[month_key] += exp.amount

    # 3. Member spending vs consumption
    balances = calculate_room_balances(room)
    member_labels = [m['user']['display_name'] for m in balances['member_balances']]
    member_paid = [m['total_paid'] for m in balances['member_balances']]
    member_share = [m['total_share'] for m in balances['member_balances']]

    return {
        'total_spent': float(round_curr(total_amount)),
        'category_chart': category_chart_data,
        'monthly_chart': {
            'labels': list(monthly_data.keys()),
            'data': [float(round_curr(v)) for v in monthly_data.values()]
        },
        'member_chart': {
            'labels': member_labels,
            'paid_data': member_paid,
            'share_data': member_share
        }
    }
