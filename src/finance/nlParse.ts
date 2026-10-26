// 演示解析：仅用关键词规则，不是 AI。正式版由 Codex 接入 Qwen3 做结构化解析，
// 解析结果同样必须经用户确认后才能写入。
import type { Account, Category, TxType } from './types';
import { parseYuan } from './money';
import { toDateStr } from './calc';

export interface Parsed {
  type?: TxType;
  amount?: number;
  categoryId?: string;
  accountId?: string;
  date?: string;
  note: string;
  missing: string[];
}

const CAT_RULES: [RegExp, RegExp][] = [
  [/午饭|晚饭|晚餐|早餐|早饭|餐|咖啡|奶茶|外卖|吃|饭/, /餐饮|餐费|饮食/],
  [/打车|地铁|公交|加油|高铁|滴滴|停车/, /交通|通勤/],
  [/房租|水电|物业/, /居住|住房|房租/],
  [/话费|宽带|流量/, /通讯|通信/],
  [/药|医院|体检|挂号/, /医疗|健康/],
  [/超市|淘宝|京东|买|衣服|日用/, /购物|日用/],
  [/电影|游戏|会员|健身|演出/, /娱乐|休闲/],
  [/书|课程|培训/, /学习|教育/],
  [/工资|发薪/, /工资|薪资/],
  [/兼职|奖金/, /兼职|奖金/],
];
const ACC_RULES: [RegExp, Account['kind']][] = [
  [/支付宝/, 'alipay'],
  [/微信/, 'wechat'],
  [/现金/, 'cash'],
  [/储蓄卡|银行卡|银行/, 'bank'],
];

export function parseEntry(text: string, accounts: Account[], cats: Category[]): Parsed {
  const t = text.trim();
  const out: Parsed = { note: '', missing: [] };
  // Capture the complete numeric token: 12.345 must fail, never become 12.34.
  const amounts = t.match(/[+-]?(?:[¥￥]\s*)?\d[\d.,，]*(?:\s*(?:元|块))?/g) ?? [];
  if (amounts.length === 1) out.amount = parseYuan(amounts[0].replace(/元|块/g, '')) ?? undefined;
  if (!out.amount) out.missing.push('金额');

  const unsupported = /转账|转给|转入|转出|还款|还债|花呗|信用卡|借|投资|基金|股票|买入|卖出|理财|退款|退回/.test(t);
  const income = /工资|发薪|收入|收到|兼职|奖金|红包/.test(t) && !/支出|花/.test(t);
  if (unsupported) out.missing.push('类型（请手动选择）');
  else out.type = income ? 'income' : 'expense';

  const cat = CAT_RULES.find(([re]) => re.test(t));
  const matchingCats = cat && out.type ? cats.filter((c) => c.kind === out.type && cat[1].test(c.name)) : [];
  if (matchingCats.length === 1) out.categoryId = matchingCats[0].id;
  else out.missing.push('类别');

  const accRules = ACC_RULES.filter(([re]) => re.test(t));
  const matchingAccounts = accRules.length === 1 ? accounts.filter((a) => a.group === 'cash' && a.kind === accRules[0][1]) : [];
  if (matchingAccounts.length === 1 && !/花呗|信用卡/.test(t)) out.accountId = matchingAccounts[0].id;
  else out.missing.push('账户');

  const d = new Date();
  if (/昨天/.test(t)) d.setDate(d.getDate() - 1);
  else if (/前天/.test(t)) d.setDate(d.getDate() - 2);
  out.date = toDateStr(d);

  out.note = t.replace(/[+-]?(?:[¥￥]\s*)?\d[\d.,，]*(?:\s*(?:元|块))?/g, '').replace(/支付宝|微信|现金|储蓄卡|银行卡|今天|昨天|前天/g, '').trim() || t;
  out.missing = Array.from(new Set(out.missing));
  return out;
}
