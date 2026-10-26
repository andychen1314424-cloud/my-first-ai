import { ArrowLeftRight, Banknote, BookOpen, Briefcase, Building2, Bus, Coins, CreditCard, Film, HeartPulse, Landmark, Phone, ShoppingBag, Smartphone, Tag, TrendingUp, Utensils, Wallet, MessageCircle } from 'lucide-react';
import type { Account, Transaction } from './types';

type Icon = typeof Wallet;

export const accountIcon = (k: Account['kind']): Icon =>
  ({ alipay: Smartphone, wechat: MessageCircle, bank: CreditCard, cash: Banknote, fund: TrendingUp, stock: TrendingUp, other: Landmark } as Record<string, Icon>)[k] ?? Wallet;

export const categoryIcon = (id?: string): Icon =>
  ({
    food: Utensils,
    transport: Bus,
    home: Building2,
    comm: Phone,
    health: HeartPulse,
    shop: ShoppingBag,
    fun: Film,
    learn: BookOpen,
    salary: Briefcase,
    side: Coins,
  } as Record<string, Icon>)[id ?? ''] ?? Tag;

export const txIcon = (t: Transaction): Icon => (t.type === 'transfer' ? ArrowLeftRight : t.type === 'repay' ? CreditCard : categoryIcon(t.categoryId));

export const TYPE_LABEL: Record<string, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  repay: '还款',
  refund: '退款',
  invest_buy: '投资买入',
  invest_sell: '投资卖出',
  lend: '借出',
  collect: '收回',
  borrow: '借入',
};
