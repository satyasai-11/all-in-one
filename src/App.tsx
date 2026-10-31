import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, ArrowDownLeft, ArrowUpRight, BadgeIndianRupee, CalendarDays, Check, CheckCircle2, CircleHelp, CirclePlus, Copy, CreditCard, Download, Eye, EyeOff, FileText, Fingerprint, Home, Landmark, LockKeyhole, Menu, MoreHorizontal, Pencil, PiggyBank, Plus, ShieldCheck, Sparkles, Trash2, Wallet, X } from 'lucide-react';
import { readDeviceRecords, writeDeviceRecords } from './deviceStorage';

type Page = 'Home' | 'Planner' | 'Cash flow' | 'Balance sheet' | 'Payments' | 'Personal vault' | 'Other info';
type Entry = { id: string; title: string; amount?: number; kind?: 'income' | 'expense'; category?: string; date?: string; status?: string; notes?: string; entryMode?: 'one-time' | 'fixed'; templateId?: string; taskType?: 'task' | 'event'; paid?: boolean };
type RecurringTemplate = { id: string; title: string; amount: number; kind: 'income' | 'expense'; category: string; dayOfMonth: number; periods: { startMonth: string; endMonth?: string }[]; changes?: { fromMonth: string; amount: number; category: string; dayOfMonth: number }[]; paidMonths?: string[] };
type Store = { transactions: Entry[]; recurringTemplates: RecurringTemplate[]; tasks: Entry[]; payments: Entry[]; assets: Entry[]; liabilities: Entry[]; vault: Entry[]; otherInfo: Entry[] };
type Collection = 'transaction' | 'recurring' | 'task' | 'payment' | 'asset' | 'liability' | 'vault' | 'otherInfo';
type EditTarget = { collection: Collection; id: string } | null;
type PinCredential = { salt: string; hash: string };

const initial: Store = { transactions: [], recurringTemplates: [], tasks: [], payments: [], assets: [], liabilities: [], vault: [], otherInfo: [] };
// One-time clean start for the user's request: clear existing records, but preserve profile and app preferences.
if (localStorage.getItem('mai-clean-start-v1') !== 'done') {
  localStorage.removeItem('mai-data');
  localStorage.setItem('mai-clean-start-v1', 'done');
}
const money = (n = 0) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const today = localDate(new Date());
const monthNow = today.slice(0, 7);
const monthLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const currentYear = new Date().getFullYear();
const defaultYears = Array.from({ length: 6 }, (_, index) => String(currentYear + index));
const pages: Page[] = ['Home', 'Planner', 'Cash flow', 'Balance sheet', 'Payments', 'Personal vault', 'Other info'];
const icons = [Home, CalendarDays, Activity, Landmark, CreditCard, LockKeyhole, FileText];
async function derivePinHash(pin: string, saltText: string) {
  const salt = Uint8Array.from(atob(saltText), character => character.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
async function makePinCredential(pin: string): Promise<PinCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltText = btoa(String.fromCharCode(...salt));
  return { salt: saltText, hash: await derivePinHash(pin, saltText) };
}

function App() {
  const [page, setPage] = useState<Page>('Home');
  const [data, setData] = useState<Store>(initial);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [persistentStorage, setPersistentStorage] = useState<boolean | null>(null);
  const [modalKind, setModalKind] = useState('');
  const [entryModeSelection, setEntryModeSelection] = useState<'one-time' | 'fixed'>('one-time');
  const [editing, setEditing] = useState<EditTarget>(null);
  const [mobile, setMobile] = useState(false);
  const [unlockedSections, setUnlockedSections] = useState<Record<Page, boolean>>({ Home: false, Planner: false, 'Cash flow': false, 'Balance sheet': false, Payments: false, 'Personal vault': false, 'Other info': false });
  const [lockEnabled, setLockEnabled] = useState<Record<Page, boolean>>(() => { try { const saved = JSON.parse(localStorage.getItem('mai-section-locks') || '{}'); return { Home: false, Planner: false, 'Cash flow': false, 'Balance sheet': saved['Balance sheet'] ?? true, Payments: false, 'Personal vault': saved['Personal vault'] ?? true, 'Other info': false }; } catch { return { Home: false, Planner: false, 'Cash flow': false, 'Balance sheet': true, Payments: false, 'Personal vault': true, 'Other info': false }; } });
  const [pinCredential, setPinCredential] = useState<PinCredential | null>(() => { try { return JSON.parse(localStorage.getItem('mai-pin-credential') || 'null'); } catch { return null; } });
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [vaultPreview, setVaultPreview] = useState<Entry | null>(null);
  const [profileName, setProfileName] = useState(() => localStorage.getItem('mai-profile-name') || '');
  const [profileDialogOpen, setProfileDialogOpen] = useState(() => !localStorage.getItem('mai-profile-name'));
  const [selectedMonth, setSelectedMonth] = useState(monthNow);
  const [removedCashflowYears, setRemovedCashflowYears] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('mai-cashflow-removed-years') || '[]') as string[]; } catch { return []; } });
  const [cashflowYears, setCashflowYears] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('mai-cashflow-years');
      const saved = raw ? JSON.parse(raw) as string[] : defaultYears;
      const removed = JSON.parse(localStorage.getItem('mai-cashflow-removed-years') || '[]') as string[];
      return [...new Set([...defaultYears, ...saved.filter(year => Number(year) >= currentYear)])].filter(year => !removed.includes(year)).sort();
    } catch { return defaultYears; }
  });
  const [flowFilter, setFlowFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [balanceTab, setBalanceTab] = useState<'Assets' | 'Liabilities'>('Assets');
  const privateMode = !lockEnabled[page] || unlockedSections[page];

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const saved = await readDeviceRecords<Partial<Store>>();
        let restored: Store;
        if (saved) restored = { ...initial, ...saved, otherInfo: Array.isArray(saved.otherInfo) ? saved.otherInfo : [], tasks: (saved.tasks || []).filter(item => !['t1', 't2', 't3'].includes(item.id)) };
        else {
          const legacy = localStorage.getItem('mai-data');
          const parsed = legacy ? JSON.parse(legacy) as Partial<Store> : {};
          restored = { ...initial, ...parsed, otherInfo: Array.isArray(parsed.otherInfo) ? parsed.otherInfo : [], tasks: (parsed.tasks || []).filter(item => !['t1', 't2', 't3'].includes(item.id)) };
          await writeDeviceRecords(restored);
          if (legacy) localStorage.removeItem('mai-data');
        }
        let persistent = false;
        try { persistent = await navigator.storage?.persist?.() ?? false; } catch { /* Best-effort only; backups remain available. */ }
        if (active) { setData(restored); setPersistentStorage(persistent ?? false); setStorageReady(true); }
      } catch (error) {
        if (active) setStorageError(error instanceof Error ? error.message : 'Could not open on-device storage.');
      }
    };
    void hydrate();
    return () => { active = false; };
  }, []);
  useEffect(() => { if (storageReady) void writeDeviceRecords(data).catch(error => { setNoticeError(true); setNotice(error instanceof Error ? error.message : 'Could not save to on-device storage. Download a backup before leaving this page.'); }); }, [data, storageReady]);
  useEffect(() => { localStorage.setItem('mai-cashflow-years', JSON.stringify(cashflowYears)); }, [cashflowYears]);
  useEffect(() => { localStorage.setItem('mai-cashflow-removed-years', JSON.stringify(removedCashflowYears)); }, [removedCashflowYears]);
  useEffect(() => { localStorage.setItem('mai-section-locks', JSON.stringify(lockEnabled)); }, [lockEnabled]);
  useEffect(() => { if (pinCredential) localStorage.setItem('mai-pin-credential', JSON.stringify(pinCredential)); }, [pinCredential]);
  useEffect(() => { if (profileName) localStorage.setItem('mai-profile-name', profileName); }, [profileName]);

  const monthTransactions = useMemo(() => transactionsForMonth(data, selectedMonth), [data, selectedMonth]);
  const visibleTransactions = flowFilter === 'all' ? monthTransactions : monthTransactions.filter(item => item.kind === flowFilter);
  const income = monthTransactions.filter(item => item.kind === 'income').reduce((sum, item) => sum + (item.amount || 0), 0);
  const expenses = monthTransactions.filter(item => item.kind === 'expense').reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalAssets = data.assets.reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalLiabilities = data.liabilities.reduce((sum, item) => sum + (item.amount || 0), 0);
  const netWorth = totalAssets - totalLiabilities;
  const currentBills = data.recurringTemplates.filter(item => item.kind === 'expense' && item.periods.some(period => period.startMonth <= monthNow && (!period.endMonth || monthNow <= period.endMonth))).sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  const homeBills = currentBills.filter(item => !item.paidMonths?.includes(monthNow)).map(item => { const change = latestChange(item, monthNow); const billDate = recurringDate(monthNow, change?.dayOfMonth ?? item.dayOfMonth); return { item, change, billDate }; }).sort((a, b) => a.billDate.localeCompare(b.billDate));
  const plannerTasks = data.tasks.filter(item => item.taskType !== 'event');
  const plannerEvents = data.tasks.filter(item => item.taskType === 'event');
  const homeTasks = data.tasks.filter(item => item.taskType !== 'event');
  const homeEvents = data.tasks.filter(item => item.taskType === 'event');

  const open = (kind: string) => { setEditing(null); setEntryModeSelection('one-time'); setModalKind(kind); };
  const gate = async () => {
    if (!lockEnabled[page]) return;
    if (unlockedSections[page]) { setUnlockedSections(current => ({ ...current, [page]: false })); if (page === 'Personal vault') { setVaultPreview(null); setModalKind(''); setEditing(null); } return; }
    const first = !pinCredential;
    const entered = window.prompt(first ? 'Create a PIN (at least 4 characters)' : 'Enter your PIN');
    if (!entered) return;
    if (first && entered.length >= 4) { try { setPinCredential(await makePinCredential(entered)); setUnlockedSections(current => ({ ...current, [page]: true })); return; } catch { setNoticeError(true); setNotice('PIN setup is unavailable in this browser context.'); return; } }
    if (pinCredential && await derivePinHash(entered, pinCredential.salt) === pinCredential.hash) { setUnlockedSections(current => ({ ...current, [page]: true })); return; }
    setNoticeError(true); setNotice(first ? 'Use at least 4 characters for the PIN.' : 'That PIN did not match.');
  };
  const requireSection = (action: () => void) => { if (!lockEnabled[page] || unlockedSections[page]) action(); else gate(); };
  const setSectionLock = async (section: Page, enabled: boolean) => {
    if (!enabled && pinCredential) {
      const entered = window.prompt('Enter your PIN to turn off this section lock');
      if (!entered || await derivePinHash(entered, pinCredential.salt) !== pinCredential.hash) { setNoticeError(true); setNotice(entered ? 'That PIN did not match.' : 'Enter your PIN to turn off this section lock.'); return; }
    }
    if (enabled && !pinCredential) {
      const entered = window.prompt('Create a PIN for this section');
      if (!entered) return;
      if (entered.length < 4) { setNoticeError(true); setNotice('Use at least 4 characters for the PIN.'); return; }
      try { setPinCredential(await makePinCredential(entered)); } catch { setNoticeError(true); setNotice('PIN setup is unavailable in this browser context.'); return; }
    }
    setLockEnabled(current => ({ ...current, [section]: enabled }));
    setUnlockedSections(current => ({ ...current, [section]: false }));
    if (section === 'Personal vault') { setVaultPreview(null); setModalKind(''); setEditing(null); }
  };
  const selectedYear = selectedMonth.slice(0, 4);
  const yearHasCashflowData = (year: string) => data.transactions.some(item => item.date?.startsWith(`${year}-`)) || data.recurringTemplates.some(item => item.periods.some(period => period.startMonth <= `${year}-12` && (!period.endMonth || period.endMonth >= `${year}-01`)));
  const historicYears = Array.from({ length: Math.max(0, currentYear - 1900) }, (_, index) => String(1900 + index)).filter(yearHasCashflowData);
  const visibleCashflowYears = [...new Set([...cashflowYears, ...historicYears])].sort();
  const addCashflowYear = () => {
    const entered = String(Math.max(...visibleCashflowYears.map(Number), currentYear - 1) + 1);
    const next = [...new Set([...cashflowYears, entered])].sort(); setCashflowYears(next); setRemovedCashflowYears(current => current.filter(year => year !== entered)); setSelectedMonth(`${entered}-01`); setNoticeError(false); setNotice(`Added ${entered}.`);
  };
  const removeCashflowYear = () => {
    if (Number(selectedYear) === currentYear) { setNoticeError(true); setNotice('The current year cannot be removed.'); return; }
    if (yearHasCashflowData(selectedYear)) { setNoticeError(true); setNotice(`${selectedYear} has cash-flow data and cannot be removed.`); return; }
    const next = cashflowYears.filter(year => year !== selectedYear); setCashflowYears(next); setRemovedCashflowYears(current => [...new Set([...current, selectedYear])]); setSelectedMonth(`${currentYear}-01`); setNoticeError(false); setNotice(`${selectedYear} removed.`);
  };

  const recordFor = (target: EditTarget): Entry | undefined => {
    if (!target) return undefined;
    if (target.collection === 'transaction') return data.transactions.find(item => item.id === target.id);
    if (target.collection === 'task') return data.tasks.find(item => item.id === target.id);
    if (target.collection === 'payment') return data.payments.find(item => item.id === target.id);
    if (target.collection === 'asset') return data.assets.find(item => item.id === target.id);
    if (target.collection === 'liability') return data.liabilities.find(item => item.id === target.id);
    if (target.collection === 'vault') return data.vault.find(item => item.id === target.id);
    if (target.collection === 'otherInfo') return data.otherInfo.find(item => item.id === target.id);
    return undefined;
  };
  const record = recordFor(editing);
  const template = editing?.collection === 'recurring' ? data.recurringTemplates.find(item => item.id === editing.id) : undefined;
  const templateChange = template ? latestChange(template, selectedMonth) : undefined;
  const defaultTitle = record?.title || (templateChange?.category ?? template?.category) || '';
  const defaultCategory = record?.category || (templateChange?.category ?? template?.category) || '';
  const defaultAmount = record?.amount ?? (templateChange?.amount ?? template?.amount);
  const defaultDate = record?.date || (template ? recurringDate(selectedMonth, templateChange?.dayOfMonth ?? template.dayOfMonth) : undefined);
  const editingPeriod = template?.periods.find(period => period.startMonth <= selectedMonth && (!period.endMonth || selectedMonth <= period.endMonth));
  const defaultDuration = editingPeriod?.endMonth ? monthCount(selectedMonth, editingPeriod.endMonth) : '';
  const defaultDueDay = templateChange?.dayOfMonth ?? 10;

  const editRecord = (collection: Collection, entry: Entry | RecurringTemplate) => {
    setEditing({ collection, id: entry.id });
    setEntryModeSelection(collection === 'recurring' || (entry as Entry).entryMode === 'fixed' ? 'fixed' : 'one-time');
    if (collection === 'recurring') setModalKind((entry as RecurringTemplate).kind === 'income' ? 'Income' : 'Expense');
    else if (collection === 'transaction') setModalKind((entry as Entry).kind === 'income' ? 'Income' : 'Expense');
    else setModalKind(collection === 'task' ? ((entry as Entry).taskType === 'event' ? 'Event' : 'Task') : collection === 'payment' ? 'Payment' : collection === 'asset' ? 'Asset' : collection === 'liability' ? 'Liability' : collection === 'otherInfo' ? 'Other info' : 'Vault entry');
  };

  const saveEntry = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountText = String(form.get('amount') ?? '');
    if (!['Task', 'Event', 'Vault entry', 'Other info'].includes(modalKind) && (!amountText || !/^\d+(\.\d{1,2})?$/.test(amountText) || !Number.isFinite(Number(amountText)))) { setNoticeError(true); setNotice('Enter a valid amount using numbers only.'); return; }
    const durationText = String(form.get('durationMonths') || '').trim();
    if (durationText && (!/^\d+$/.test(durationText) || Number(durationText) < 1)) { setNoticeError(true); setNotice('Repeat duration must be a whole number of months greater than zero.'); return; }
    const durationMonths = durationText ? Number(durationText) : undefined;
    const dueDayText = String(form.get('dueDay') || '10').trim();
    if (((modalKind === 'Expense' && entryModeSelection === 'fixed') || (editing?.collection === 'recurring' && template?.kind === 'expense')) && (!/^\d+$/.test(dueDayText) || Number(dueDayText) < 1 || Number(dueDayText) > 31)) { setNoticeError(true); setNotice('Due day must be a number from 1 to 31.'); return; }
    const date = String(form.get('date') || today);
    const category = String(form.get('category') || (modalKind === 'Payment' ? form.get('title') : '') || 'Other').trim();
    const cashflow = modalKind === 'Income' || modalKind === 'Expense';
    const item: Entry = {
      id: record?.id || crypto.randomUUID(),
      title: cashflow ? category : String(form.get('title') || '').trim(),
      amount: Number(form.get('amount') || 0), category, date,
      status: record?.status || 'Pending',
      notes: String(form.get('notes') || ''),
    };
    if (modalKind === 'Vault entry' || modalKind === 'Other info') item.notes = String(form.get('information') || '').trim();
    const next = { ...data };
    if (cashflow) {
      item.kind = modalKind.toLowerCase() as 'income' | 'expense';
      if (editing?.collection === 'recurring') {
        next.recurringTemplates = data.recurringTemplates.map(current => current.id !== editing.id ? current : ({ ...resizeRecurring(current, date.slice(0, 7), durationMonths), changes: [...(current.changes || []).filter(change => change.fromMonth < date.slice(0, 7)), { fromMonth: date.slice(0, 7), amount: item.amount || 0, category, dayOfMonth: item.kind === 'expense' ? Number(dueDayText) : Number(date.slice(-2)) }] }));
      } else if (editing?.collection === 'transaction') {
        item.entryMode = record?.entryMode || 'one-time';
        next.transactions = data.transactions.map(current => current.id === editing.id ? { ...current, ...item } : current);
      } else if (form.get('entryMode') === 'fixed') {
        const startMonth = date.slice(0, 7);
        const recurring: RecurringTemplate = { id: crypto.randomUUID(), title: category, amount: item.amount || 0, kind: item.kind, category, dayOfMonth: item.kind === 'expense' ? Number(dueDayText) : Number(date.slice(-2)), periods: [{ startMonth, ...(durationMonths ? { endMonth: shiftMonth(startMonth, durationMonths - 1) } : {}) }] };
        next.recurringTemplates = [...data.recurringTemplates, recurring];
        item.entryMode = 'fixed';
      } else {
        item.entryMode = 'one-time';
        next.transactions = [item, ...data.transactions];
      }
      setSelectedMonth(date.slice(0, 7));
    } else if (modalKind === 'Task' || modalKind === 'Event') { item.taskType = modalKind === 'Event' ? 'event' : 'task'; next.tasks = editing?.collection === 'task' ? data.tasks.map(current => current.id === editing.id ? { ...current, ...item } : current) : [item, ...data.tasks]; }
    else if (modalKind === 'Payment' && form.get('entryMode') === 'fixed') {
      const recurring: RecurringTemplate = { id: crypto.randomUUID(), title: item.title, amount: item.amount || 0, kind: 'expense', category, dayOfMonth: Number(date.slice(-2)), periods: [{ startMonth: date.slice(0, 7) }] };
      next.recurringTemplates = [...data.recurringTemplates, recurring];
      item.entryMode = 'fixed';
    }
    else if (modalKind === 'Payment') next.payments = editing?.collection === 'payment' ? data.payments.map(current => current.id === editing.id ? { ...current, ...item } : current) : [item, ...data.payments];
    else if (modalKind === 'Asset') next.assets = editing?.collection === 'asset' ? data.assets.map(current => current.id === editing.id ? { ...current, ...item } : current) : [item, ...data.assets];
    else if (modalKind === 'Liability') next.liabilities = editing?.collection === 'liability' ? data.liabilities.map(current => current.id === editing.id ? { ...current, ...item } : current) : [item, ...data.liabilities];
    else if (modalKind === 'Vault entry') next.vault = editing?.collection === 'vault' ? data.vault.map(current => current.id === editing.id ? { ...current, ...item } : current) : [item, ...data.vault];
    else if (modalKind === 'Other info') next.otherInfo = editing?.collection === 'otherInfo' ? data.otherInfo.map(current => current.id === editing.id ? { ...current, ...item } : current) : [item, ...data.otherInfo];
    setData(next); setModalKind(''); setNoticeError(false); setNotice(editing ? 'Entry updated' : (item.entryMode === 'fixed' ? 'Fixed monthly entry saved' : `${modalKind} saved`)); setEditing(null);
  };

  const truncateRecurring = (id: string, fromMonth: string) => data.recurringTemplates.flatMap(item => {
    if (item.id !== id) return [item];
    const cutoff = previousMonth(fromMonth);
    const periods = item.periods.flatMap(period => {
      if (period.startMonth >= fromMonth) return [];
      if (period.endMonth && period.endMonth < fromMonth) return [period];
      return period.startMonth <= cutoff ? [{ ...period, endMonth: cutoff }] : [];
    });
    return periods.length ? [{ ...item, periods, changes: (item.changes || []).filter(change => change.fromMonth < fromMonth) }] : [];
  });
  const deleteRecord = (collection: Collection, id: string, templateId?: string) => {
    if (!window.confirm('Delete this entry?')) return;
    if (collection === 'transaction' && templateId) setData({ ...data, recurringTemplates: truncateRecurring(templateId, selectedMonth) });
    else if (collection === 'transaction') setData({ ...data, transactions: data.transactions.filter(item => item.id !== id) });
    else if (collection === 'recurring') setData({ ...data, recurringTemplates: truncateRecurring(id, selectedMonth) });
    else if (collection === 'task') setData({ ...data, tasks: data.tasks.filter(item => item.id !== id) });
    else if (collection === 'payment') setData({ ...data, payments: data.payments.filter(item => item.id !== id) });
    else if (collection === 'asset') setData({ ...data, assets: data.assets.filter(item => item.id !== id) });
    else if (collection === 'liability') setData({ ...data, liabilities: data.liabilities.filter(item => item.id !== id) });
    else if (collection === 'vault') setData({ ...data, vault: data.vault.filter(item => item.id !== id) });
    else if (collection === 'otherInfo') setData({ ...data, otherInfo: data.otherInfo.filter(item => item.id !== id) });
    setNoticeError(false); setNotice(collection === 'recurring' || Boolean(templateId) ? 'Fixed entry deleted from this month onward' : 'Entry deleted');
  };
  const editCashflow = (entry: Entry) => {
    if (entry.entryMode === 'fixed' && entry.templateId) editRecord('recurring', data.recurringTemplates.find(item => item.id === entry.templateId)!);
    else editRecord('transaction', entry);
  };
  const completeTask = (id: string) => setData({ ...data, tasks: data.tasks.map(item => item.id === id ? { ...item, status: item.status === 'Completed' ? 'Pending' : 'Completed' } : item) });
  const markPaid = (id: string) => setData({ ...data, payments: data.payments.map(item => item.id === id ? { ...item, status: 'Paid' } : item) });
  const markBillPaid = (id: string) => { setData(current => ({ ...current, recurringTemplates: current.recurringTemplates.map(item => item.id === id ? { ...item, paidMonths: [...new Set([...(item.paidMonths || []), monthNow])] } : item) })); setNoticeError(false); setNotice('Bill marked as paid for this month.'); };
  const deleteBill = (id: string) => { if (!window.confirm('Delete this recurring bill from this month onward?')) return; setData({ ...data, recurringTemplates: truncateRecurring(id, monthNow) }); setNoticeError(false); setNotice('Bill deleted from this month onward.'); };
  const toggleRecurring = (id: string) => setData({ ...data, recurringTemplates: data.recurringTemplates.map(item => {
    if (item.id !== id) return item;
    const activePeriod = item.periods.find(period => period.startMonth <= monthNow && (!period.endMonth || monthNow <= period.endMonth));
    const periods = activePeriod ? [...item.periods.flatMap(period => {
      if (period === activePeriod) return period.startMonth < monthNow ? [{ ...period, endMonth: previousMonth(monthNow) }] : [];
      return period.startMonth < monthNow ? [period] : [];
    })] : [...item.periods, { startMonth: nextMonth(monthNow) }];
    return { ...item, periods };
  }) });
  const exportJson = () => { const backup = { app: 'All In One', version: 1, exportedAt: new Date().toISOString(), profileName, data, cashflowYears, removedCashflowYears, lockEnabled }; const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'all-in-one-backup.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1500); };
  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const collections: (keyof Store)[] = ['transactions', 'recurringTemplates', 'tasks', 'payments', 'assets', 'liabilities', 'vault', 'otherInfo'];
      let backup: { data?: Partial<Store>; profileName?: string; cashflowYears?: string[]; removedCashflowYears?: string[]; lockEnabled?: Record<Page, boolean> } & Partial<Store>;
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await file.arrayBuffer());
        const importedData: Record<string, unknown[]> = {};
        for (const key of collections) {
          const sheet = workbook.Sheets[key];
          const rows = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet) : [];
          importedData[key] = rows.map(row => Object.fromEntries(Object.entries(row).map(([field, value]) => [field, (field === 'periods' || field === 'changes' || field === 'paidMonths') && typeof value === 'string' ? JSON.parse(value) : value])));
        }
        const metaRows = workbook.Sheets['Backup Info'] ? XLSX.utils.sheet_to_json<{ profileName?: string }>(workbook.Sheets['Backup Info']) : [];
        const yearRows = workbook.Sheets['Cash Flow Years'] ? XLSX.utils.sheet_to_json<{ year: string | number; removed?: boolean }>(workbook.Sheets['Cash Flow Years']) : [];
        const lockRows = workbook.Sheets['Section Locks'] ? XLSX.utils.sheet_to_json<{ section: Page; requirePin: boolean }>(workbook.Sheets['Section Locks']) : [];
        backup = { data: importedData as unknown as Partial<Store>, profileName: metaRows[0]?.profileName, cashflowYears: yearRows.filter(row => !row.removed).map(row => String(row.year)), removedCashflowYears: yearRows.filter(row => row.removed).map(row => String(row.year)), lockEnabled: lockRows.length ? Object.fromEntries(lockRows.map(row => [row.section, row.requirePin])) as Record<Page, boolean> : undefined };
      } else backup = JSON.parse(await file.text()) as typeof backup;
      const parsed = (backup.data || backup) as Partial<Store>;
      const requiredCollections: (keyof Store)[] = ['transactions', 'recurringTemplates', 'tasks', 'payments', 'assets', 'liabilities', 'vault'];
      if (!requiredCollections.every(key => Array.isArray(parsed[key]))) throw new Error('This file is not a valid All In One Excel or JSON backup.');
      if (!window.confirm('Replace the data saved in this browser with the selected backup?')) return;
      setData({ ...initial, ...parsed, otherInfo: Array.isArray(parsed.otherInfo) ? parsed.otherInfo : [] } as Store);
      if (Array.isArray(backup.cashflowYears)) setCashflowYears([...new Set([...defaultYears, ...backup.cashflowYears.filter(year => Number(year) >= currentYear)])].filter(year => !backup.removedCashflowYears?.includes(year)).sort());
      if (Array.isArray(backup.removedCashflowYears)) setRemovedCashflowYears(backup.removedCashflowYears);
      if (backup.lockEnabled) setLockEnabled(backup.lockEnabled);
      if (backup.profileName) setProfileName(backup.profileName);
      setNoticeError(false); setNotice('Backup restored.');
    } catch (error) { setNoticeError(true); setNotice(error instanceof Error ? error.message : 'Could not read this backup file.'); }
    finally { event.target.value = ''; }
  };
  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    for (const [key, rows] of Object.entries(data)) {
      const flattened = rows.map(row => Object.fromEntries(Object.entries(row).map(([field, value]) => [field, Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : value])));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flattened), key.slice(0, 31));
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ app: 'All In One', version: 1, exportedAt: new Date().toISOString(), profileName }]), 'Backup Info');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([...cashflowYears.map(year => ({ year, removed: false })), ...removedCashflowYears.map(year => ({ year, removed: true }))]), 'Cash Flow Years');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(Object.entries(lockEnabled).map(([section, requirePin]) => ({ section, requirePin }))), 'Section Locks');
    XLSX.writeFile(workbook, 'all-in-one-backup.xlsx');
  };
  const copyVaultInformation = async () => {
    try { await navigator.clipboard.writeText(vaultPreview?.notes || ''); setNoticeError(false); setNotice('Information copied to clipboard.'); }
    catch { setNoticeError(true); setNotice('Could not copy. Check clipboard permission and try again.'); }
  };
  const saveProfileName = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('profileName') || '').trim();
    if (!name) { setNoticeError(true); setNotice('Enter your name to continue.'); return; }
    setProfileName(name); localStorage.setItem('mai-profile-name', name); setProfileDialogOpen(false); setNoticeError(false); setNotice('Profile name saved.');
  };

  if (storageError) return <div className="storage-status-screen"><AlertCircle size={26} /><h1>Could not open device storage</h1><p>{storageError}</p><p>Your records were not loaded. Reload the app or restore a backup in a supported browser.</p><button className="button primary" onClick={() => window.location.reload()}>Reload app</button></div>;
  if (!storageReady) return <div className="storage-status-screen"><div className="brand-icon"><Sparkles size={19} /></div><h1>Opening your records</h1><p>Loading from this device…</p></div>;

  return <div className="shell">
    <aside className={`sidebar ${mobile ? 'show' : ''}`}>
      <div className="brand"><div className="brand-icon"><Sparkles size={19} /></div><span><b>All In One</b></span><button className="icon-button mobile-close" onClick={() => setMobile(false)}><X size={18} /></button></div>
      <button className="workspace workspace-profile" onClick={() => setProfileDialogOpen(true)}><div className="avatar">{profileName ? profileName.trim().charAt(0).toUpperCase() : 'P'}</div><div><strong>{profileName || 'Add your name'}</strong></div><Pencil size={15} /></button>
      <div className="nav-label">WORKSPACE</div><nav>{pages.map((item, index) => { const Icon = icons[index]; return <button key={item} className={`nav-item ${page === item ? 'active' : ''}`} onClick={() => { setPage(item); setMobile(false); }}><Icon size={18} /><span>{item}</span></button>; })}</nav>
      <div className="sidebar-bottom"><div className="sync"><span className="green-dot" /> {persistentStorage ? 'Saved on this device' : 'On-device · back up regularly'}</div><button className="nav-item" onClick={exportExcel}><Download size={18} /> Download Excel backup</button><button className="nav-item" onClick={exportJson}><Download size={18} /> Download JSON backup</button><label className="nav-item import-backup"><Download size={18} /> Restore from backup<input type="file" accept="application/json,.json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={importBackup} /></label></div>
    </aside>
    <main className="main">
      <header><button className="icon-button mobile-menu" onClick={() => setMobile(true)}><Menu /></button><div className="crumb">Workspace <span>/</span> <b>{page}</b></div></header>
      <div className="content">
        <div className="title-row"><div><div className="eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()} <span className="live-dot" /></div>{page !== 'Home' && <><h1>{page}</h1><p>Keep your personal life organized in one calm place.</p></>}</div><div className="title-actions">{(page === 'Balance sheet' || page === 'Personal vault') && <><label className="section-lock-choice"><input type="checkbox" checked={lockEnabled[page]} onChange={event => setSectionLock(page, event.target.checked)} /> Require PIN</label>{lockEnabled[page] && <button className="button subtle" onClick={gate}>{unlockedSections[page] ? <><EyeOff size={16} /> Lock this section</> : <><Fingerprint size={17} /> {pinCredential ? 'Unlock this section' : 'Set PIN & unlock'}</>}</button>}</>}{page === 'Home' && <button className="button primary" onClick={() => open('Task')}><Plus size={17} /> Add task</button>}{page === 'Planner' && <><button className="button subtle" onClick={() => open('Event')}><Plus size={17} /> Add event</button><button className="button primary" onClick={() => open('Task')}><Plus size={17} /> Add task</button></>}</div></div>
        <div className="prototype-warning"><AlertCircle size={16} /><span><b>On this device only:</b> records do not sync. PIN locks hide sections; saved records and backups are not encrypted. Keep backups somewhere separate from your phone.</span></div>
        {notice && <div className={`toast ${noticeError ? 'error' : ''}`}>{noticeError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{notice}<button onClick={() => { setNotice(''); setNoticeError(false); }}><X size={14} /></button></div>}

        {page === 'Home' && <>
          <section className="quick"><div className="quick-title"><h2>Quick actions</h2><span>Add something right away</span></div><div className="quick-grid home-planner-actions"><QuickAction icon={<ArrowDownLeft size={18} />} tone="qi-green" title="Add income" subtitle="Record income" onClick={() => open('Income')} /><QuickAction icon={<ArrowUpRight size={18} />} tone="qi-orange" title="Add expense" subtitle="Record spending" onClick={() => open('Expense')} /><QuickAction icon={<Check size={18} />} tone="qi-purple" title="Create a task" subtitle="Clear your mind" onClick={() => open('Task')} /><QuickAction icon={<CalendarDays size={18} />} tone="qi-blue" title="Add an event" subtitle="Save a date" onClick={() => open('Event')} /></div></section>
          <div className="home-dashboard-grid"><section className="panel home-items"><div className="panel-head"><div><h2>Upcoming payments</h2><p>Monthly expenses you still need to pay.</p></div><button className="text-button" onClick={() => setPage('Payments')}>Open payments →</button></div>{homeBills.length ? homeBills.map(({ item, change, billDate }) => { const overdue = billDate < today; return <div className="payment-row" key={item.id}><div className="pay-icon"><CreditCard size={17} /></div><div className="pay-info"><strong>{change?.category || item.category}</strong><small className={overdue ? 'overdue-text' : ''}>{billDate} · {overdue ? `Overdue by ${daysOverdue(billDate)} ${daysOverdue(billDate) === 1 ? 'day' : 'days'}` : daysUntil(billDate) === 0 ? 'Due today' : `${daysUntil(billDate)} days remaining`}</small></div><div className="pay-amount">{money(change?.amount ?? item.amount)}</div><button className="button subtle paid-button" onClick={() => markBillPaid(item.id)}><Check size={15} /> Mark paid</button></div>; }) : <div className="empty-state">No unpaid monthly payments. Add a monthly expense in Cash Flow to track it here.</div>}<button className="add-row" onClick={() => setPage('Cash flow')}><CirclePlus size={17} /> Add or manage monthly expenses</button></section>
          <section className="panel home-items"><div className="panel-head"><div><h2>Tasks</h2><p>Tasks created from Home or Planner.</p></div><button className="text-button" onClick={() => setPage('Planner')}>Open planner →</button></div>{homeTasks.length ? homeTasks.map(item => <TaskRow key={item.id} item={item} complete={() => completeTask(item.id)} onEdit={() => editRecord('task', item)} onDelete={() => deleteRecord('task', item.id)} />) : <div className="empty-state">No tasks yet.</div>}<button className="add-row" onClick={() => open('Task')}><CirclePlus size={17} /> Add a task</button></section></div>
          <section className="panel home-items home-events"><div className="panel-head"><div><h2>Events</h2><p>Events created from Home or Planner.</p></div><button className="text-button" onClick={() => setPage('Planner')}>Open planner →</button></div>{homeEvents.length ? homeEvents.map(item => <TaskRow key={item.id} item={item} complete={() => completeTask(item.id)} onEdit={() => editRecord('task', item)} onDelete={() => deleteRecord('task', item.id)} />) : <div className="empty-state">No events yet.</div>}<button className="add-row" onClick={() => open('Event')}><CirclePlus size={17} /> Add an event</button></section>
        </>}

        {page === 'Planner' && <div className="planner-grid"><section className="panel"><div className="panel-head"><div><h2>Tasks</h2><p>Track work you want to complete.</p></div><button className="button primary" onClick={() => open('Task')}><Plus size={16} /> Add task</button></div>{plannerTasks.length ? plannerTasks.map(item => <TaskRow key={item.id} item={item} complete={() => completeTask(item.id)} onEdit={() => editRecord('task', item)} onDelete={() => deleteRecord('task', item.id)} />) : <div className="empty-state">No tasks yet.</div>}</section><section className="panel"><div className="panel-head"><div><h2>Events</h2><p>Keep track of dates and occasions.</p></div><button className="button primary" onClick={() => open('Event')}><Plus size={16} /> Add event</button></div>{plannerEvents.length ? plannerEvents.map(item => <TaskRow key={item.id} item={item} complete={() => completeTask(item.id)} onEdit={() => editRecord('task', item)} onDelete={() => deleteRecord('task', item.id)} />) : <div className="empty-state">No events yet.</div>}</section></div>}

        {page === 'Cash flow' && <section className="cashflow"><div className="cashflow-toolbar"><div className="month-year-picker"><label className="month-picker">Month <select value={selectedMonth.slice(5, 7)} onChange={event => setSelectedMonth(`${selectedMonth.slice(0, 4)}-${event.target.value}`)}>{monthLabels.map((label, index) => <option key={label} value={String(index + 1).padStart(2, '0')}>{label}</option>)}</select></label><label className="month-picker">Year <select value={selectedMonth.slice(0, 4)} onChange={event => setSelectedMonth(`${event.target.value}-${selectedMonth.slice(5, 7)}`)}>{visibleCashflowYears.map(year => <option key={year}>{year}</option>)}</select></label><div className="year-actions"><button className="button subtle year-button" onClick={addCashflowYear}><Plus size={14} /> Add year</button><button className="button subtle year-button" title={Number(selectedYear) === currentYear ? 'The current year cannot be removed' : yearHasCashflowData(selectedYear) ? 'This year contains cash-flow data' : 'Remove this year'} disabled={Number(selectedYear) === currentYear || yearHasCashflowData(selectedYear)} onClick={removeCashflowYear}><Trash2 size={14} /> Delete year</button></div></div><div className="cashflow-actions"><button className="button subtle" onClick={() => requireSection(() => open('Income'))}><ArrowDownLeft size={16} /> Add income</button><button className="button primary" onClick={() => requireSection(() => open('Expense'))}><ArrowUpRight size={16} /> Add expense</button></div></div>
          <section className="stats"><FlowCard title="Monthly income" value={privateMode ? money(income) : '••••••'} subtitle={`${selectedMonth} · Click to view entries`} tone="mint" icon={<ArrowDownLeft />} active={flowFilter === 'income'} onClick={() => setFlowFilter(flowFilter === 'income' ? 'all' : 'income')} /><FlowCard title="Monthly expenses" value={privateMode ? money(expenses) : '••••••'} subtitle={`${selectedMonth} · Click to view entries`} tone="peach" icon={<ArrowUpRight />} active={flowFilter === 'expense'} onClick={() => setFlowFilter(flowFilter === 'expense' ? 'all' : 'expense')} /><FlowCard title="Monthly balance" value={privateMode ? money(income - expenses) : '••••••'} subtitle={selectedMonth} tone="lavender" icon={<Wallet />} active={flowFilter === 'all'} onClick={() => setFlowFilter('all')} /></section>
          <section className="panel full-panel"><div className="panel-head"><div><h2>{flowFilter === 'income' ? 'Income entries' : flowFilter === 'expense' ? 'Expense entries' : 'All transactions'} · {selectedMonth}</h2><p>Monthly entries are included in this month’s totals and balance even while their payments are pending.</p></div></div>{visibleTransactions.length ? visibleTransactions.map(item => <div className="payment-row" key={item.id}><div className={`pay-icon ${item.kind === 'income' ? 'pay-green' : ''}`}>{item.kind === 'income' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</div><div className="pay-info"><strong>{privateMode ? item.title : 'Private entry'}</strong><small>{privateMode ? `${item.date} · ${item.category}${item.entryMode === 'fixed' ? ` · Monthly · ${item.kind === 'expense' ? (item.paid ? 'Paid' : 'Payment pending') : 'Expected income'}` : ''}` : 'Unlock Cash Flow to view details'}</small></div><div className={`pay-amount ${item.kind === 'income' ? 'income' : ''}`}>{privateMode ? `${item.kind === 'income' ? '+' : '−'}${money(item.amount)}` : '••••••'}</div>{privateMode && <RowActions onEdit={() => editCashflow(item)} onDelete={() => deleteRecord(item.entryMode === 'fixed' ? 'recurring' : 'transaction', item.templateId || item.id)} />}</div>) : <div className="empty-state">No entries recorded for {selectedMonth}. Use Add income or Add expense.</div>}</section>
          <section className="panel recurring-panel"><div className="panel-head"><div><h2>Monthly entries</h2><p>Leave duration empty to continue until you edit or pause it.</p></div></div>{data.recurringTemplates.length ? data.recurringTemplates.map(item => { const active = item.periods.some(period => period.startMonth <= selectedMonth && (!period.endMonth || selectedMonth <= period.endMonth)); const change = latestChange(item, selectedMonth); return <div className="payment-row" key={item.id}><div className={`pay-icon ${item.kind === 'income' ? 'pay-green' : ''}`}>{item.kind === 'income' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</div><div className="pay-info"><strong>{privateMode ? (change?.category || item.category) : 'Private monthly entry'}</strong><small>{privateMode ? `${item.kind} · starts ${item.periods[0]?.startMonth} · ${active ? 'Active this month' : 'Not active this month'}` : 'Unlock Cash Flow to view details'}</small></div><div className="pay-amount">{privateMode ? money(change?.amount ?? item.amount) : '••••••'}</div>{privateMode && <><button className="button subtle paid-button" onClick={() => editRecord('recurring', item)}>Edit</button><button className="button subtle paid-button" onClick={() => toggleRecurring(item.id)}>{active ? 'Pause' : 'Resume'}</button><RowActions onDelete={() => deleteRecord('recurring', item.id)} /></>}</div>; }) : <div className="empty-small">No monthly entries yet.</div>}</section>
        </section>}

        {page === 'Balance sheet' && <><div className="balance-intro"><div><h2>Your money position</h2><p>Owned and owed to you, minus what you owe. Monthly income and expenses are separate.</p></div></div><section className="stats balance-stats"><Metric title="Owned & owed to you" amount={totalAssets} visible={privateMode} tone="mint" icon={<PiggyBank size={18} />} /><Metric title="What you owe" amount={totalLiabilities} visible={privateMode} tone="peach" icon={<Landmark size={18} />} /><Metric title="Net position" amount={netWorth} visible={privateMode} tone="lavender" icon={<Wallet size={18} />} /></section><section className="panel full-panel"><div className="panel-head"><div><h2>Owned / owed to me & what I owe</h2><p>Include property, gold, investments, money lent to others, and loans or debt you owe.</p></div><div className="balance-actions"><button className="button subtle" onClick={() => requireSection(() => open('Asset'))}><Plus size={15} /> Add owned / owed to me</button><button className="button primary" onClick={() => requireSection(() => open('Liability'))}><Plus size={15} /> Add loan / debt owed</button></div></div><div className="balance-tabs"><button className={balanceTab === 'Assets' ? 'selected' : ''} onClick={() => setBalanceTab('Assets')}>Owned / owed to me <span>{data.assets.length}</span></button><button className={balanceTab === 'Liabilities' ? 'selected' : ''} onClick={() => setBalanceTab('Liabilities')}>What I owe <span>{data.liabilities.length}</span></button></div>{(balanceTab === 'Assets' ? data.assets : data.liabilities).length ? (balanceTab === 'Assets' ? data.assets : data.liabilities).map(item => <div className="payment-row" key={item.id}><div className="pay-icon">{balanceTab === 'Assets' ? <PiggyBank size={17} /> : <Landmark size={17} />}</div><div className="pay-info"><strong>{privateMode ? item.title : 'Private balance item'}</strong><small>{privateMode ? item.category : 'Details locked'}</small></div><div className="pay-amount">{privateMode ? money(item.amount) : '••••••'}</div>{privateMode && <RowActions onEdit={() => editRecord(balanceTab === 'Assets' ? 'asset' : 'liability', item)} onDelete={() => deleteRecord(balanceTab === 'Assets' ? 'asset' : 'liability', item.id)} />}</div>) : <div className="empty-state">Nothing recorded in “{balanceTab === 'Assets' ? 'Owned / owed to me' : 'What I owe'}” yet. Add an item above.</div>}</section></>}

        {page === 'Payments' && <section className="panel full-panel"><div className="panel-head"><div><h2>Payments to make this month</h2><p>These are recurring expenses added in Cash Flow. One-time spending stays out of Payments.</p></div></div>{currentBills.length ? currentBills.map(item => { const paid = item.paidMonths?.includes(monthNow) || false; const change = latestChange(item, monthNow); const billDate = recurringDate(monthNow, change?.dayOfMonth ?? item.dayOfMonth); const overdue = !paid && billDate < today; return <div className="payment-row" key={item.id}><div className="pay-icon"><CreditCard size={17} /></div><div className="pay-info"><strong>{privateMode ? (change?.category || item.category) : 'Private bill'}</strong><small className={privateMode && overdue ? 'overdue-text' : ''}>{privateMode ? `${billDate} · ${paid ? 'Paid this month' : overdue ? 'Overdue' : daysUntil(billDate) === 0 ? 'Due today' : `${daysUntil(billDate)} days remaining`}` : 'Details locked'}</small></div><div className="pay-amount">{privateMode ? money(change?.amount ?? item.amount) : '••••••'}</div>{privateMode && <>{!paid && <button className="button subtle paid-button" onClick={() => markBillPaid(item.id)}><Check size={15} /> Mark paid</button>}<RowActions onEdit={() => { setSelectedMonth(monthNow); editRecord('recurring', item); }} onDelete={() => deleteBill(item.id)} /></>}</div>; }) : <div className="empty-state">No recurring bills this month. Add a monthly expense in Cash Flow to track it here.</div>}<button className="add-row" onClick={() => setPage('Cash flow')}><CirclePlus size={17} /> Add or manage expenses in Cash Flow</button></section>}

        {page === 'Personal vault' && <section className="panel full-panel vault-planner">{privateMode ? <><div className="panel-head"><div><h2>Personal vault</h2><p>Custom categories with unrestricted information text.</p></div><div className="balance-actions"><button className="button primary" onClick={() => open('Vault entry')}><Plus size={16} /> Add vault entry</button></div></div>{data.vault.length ? data.vault.map(item => <div className="vault-record" key={item.id}><div className="task-row vault-row"><div className="vault-type-icon"><LockKeyhole size={16} /></div><div className="task-info"><strong>{item.title}</strong><small>{item.category}</small></div><div className="vault-value">Saved</div><><button className="button subtle paid-button" onClick={() => setVaultPreview(item)}><Eye size={15} /> View & copy</button><RowActions onEdit={() => editRecord('vault', item)} onDelete={() => deleteRecord('vault', item.id)} /></></div></div>) : <div className="empty-state">Your vault is empty. Add an entry with any information you choose.</div>}<button className="add-row" onClick={() => open('Vault entry')}><CirclePlus size={17} /> Add another personal reference</button></> : <div className="vault-locked"><LockKeyhole size={24} /><h2>Personal Vault is locked</h2><p>Unlock with your PIN to view or manage saved information.</p><button className="button primary" onClick={gate}><Fingerprint size={16} /> Unlock Personal Vault</button></div>}</section>}

        {page === 'Other info' && <section className="panel full-panel vault-planner"><div className="panel-head"><div><h2>Other information</h2><p>Save extra notes or reference details with your own category.</p></div><button className="button primary" onClick={() => open('Other info')}><Plus size={16} /> Add information</button></div>{data.otherInfo.length ? data.otherInfo.map(item => <div className="vault-record" key={item.id}><div className="task-row vault-row"><div className="vault-type-icon"><FileText size={16} /></div><div className="task-info"><strong>{item.title}</strong><small>{item.category}</small></div><div className="vault-value">Saved</div><><button className="button subtle paid-button" onClick={() => setVaultPreview(item)}><Eye size={15} /> View & copy</button><RowActions onEdit={() => editRecord('otherInfo', item)} onDelete={() => deleteRecord('otherInfo', item.id)} /></></div></div>) : <div className="empty-state">No extra information saved. Add a note or reference here.</div>}<button className="add-row" onClick={() => open('Other info')}><CirclePlus size={17} /> Add other information</button></section>}

        <footer><span>Made for a little more peace of mind.</span><span><CircleHelp size={14} /> Help & feedback</span></footer>
      </div>
    </main>

    {profileDialogOpen && <div className="overlay" onMouseDown={event => { if (profileName && event.target === event.currentTarget) setProfileDialogOpen(false); }}><form className="modal" onSubmit={saveProfileName}><div className="modal-head"><div><span className="eyebrow">PERSONAL SPACE</span><h2>{profileName ? 'Edit your name' : 'Create your local profile'}</h2></div>{profileName && <button type="button" className="icon-button" onClick={() => setProfileDialogOpen(false)}><X size={19} /></button>}</div><label>Your name<input autoFocus name="profileName" type="text" required maxLength={80} defaultValue={profileName} placeholder="Enter your name" /></label><div className="modal-note"><ShieldCheck size={15} /> Your name is saved in this browser and shown in your profile. This local version does not create an online account.</div><div className="modal-actions">{profileName && <button type="button" className="button subtle" onClick={() => setProfileDialogOpen(false)}>Cancel</button>}<button className="button primary" type="submit">Save name</button></div></form></div>}
    {vaultPreview && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) setVaultPreview(null); }}><section className="modal vault-preview-modal"><div className="modal-head"><div><span className="eyebrow">SAVED INFORMATION</span><h2>{vaultPreview.title}</h2><p>{vaultPreview.category}</p></div><button type="button" className="icon-button" onClick={() => setVaultPreview(null)}><X size={19} /></button></div><div className="vault-preview-text">{vaultPreview.notes}</div><div className="modal-actions"><button className="button subtle" onClick={() => setVaultPreview(null)}>Close</button><button className="button primary" onClick={copyVaultInformation}><Copy size={16} /> Copy information</button></div></section></div>}
    {modalKind && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) { setModalKind(''); setEditing(null); } }}><form className="modal" onSubmit={saveEntry}><div className="modal-head"><div><span className="eyebrow">PERSONAL SPACE</span><h2>{editing ? 'Edit' : 'Add'} {modalKind.toLowerCase()}</h2></div><button type="button" className="icon-button" onClick={() => { setModalKind(''); setEditing(null); }}><X size={19} /></button></div>
      {modalKind !== 'Vault entry' && modalKind !== 'Income' && modalKind !== 'Expense' && <label>{modalKind === 'Task' || modalKind === 'Event' ? 'Title' : modalKind === 'Asset' ? 'Owned or owed item' : modalKind === 'Liability' ? 'Loan or debt name' : 'Name'}<input autoFocus name="title" required defaultValue={defaultTitle} placeholder={modalKind === 'Task' ? 'e.g. Call the dentist' : modalKind === 'Asset' ? 'e.g. Gold, investment, money lent' : modalKind === 'Liability' ? 'e.g. Home loan, money borrowed' : 'Enter a name'} /></label>}
      {modalKind === 'Vault entry' || modalKind === 'Other info' ? <><label>Category<input name="category" required defaultValue={defaultCategory} placeholder="Type your own category" /></label><label>Information<textarea name="information" required rows={9} defaultValue={record?.notes || ''} placeholder="Type everything you want to save. Multiple lines are fine." /></label><div className="modal-note"><ShieldCheck size={15} /> Do not store CVVs, card PINs, OTPs, or banking passwords.</div></> : <>
        {!['Task', 'Event'].includes(modalKind) && <label>Amount (₹)<input name="amount" type="number" inputMode="decimal" min="0" step="0.01" required defaultValue={defaultAmount ?? ''} placeholder="0" /></label>}
        {(modalKind === 'Income' || modalKind === 'Expense' || modalKind === 'Payment') && !editing && <fieldset className="entry-mode-field"><legend>{modalKind === 'Payment' ? 'Payment type' : 'Entry type'}</legend><div className="entry-mode-options"><label><input type="radio" name="entryMode" value="one-time" checked={entryModeSelection === 'one-time'} onChange={() => setEntryModeSelection('one-time')} /><span>One-time</span></label><label><input type="radio" name="entryMode" value="fixed" checked={entryModeSelection === 'fixed'} onChange={event => { setEntryModeSelection('fixed'); if (modalKind === 'Payment') { const dateInput = event.currentTarget.form?.elements.namedItem('date') as HTMLInputElement | null; if (dateInput) dateInput.value = `${monthNow}-10`; } }} /><span>Monthly</span></label></div></fieldset>}
        {(modalKind === 'Income' || modalKind === 'Expense') && (entryModeSelection === 'fixed' || editing?.collection === 'recurring') && <label className="duration-field">Repeat for how many months? (optional)<input name="durationMonths" type="number" inputMode="numeric" min="1" step="1" defaultValue={defaultDuration} placeholder="Leave empty to repeat until you stop it" /><small>Leave this empty to keep it repeating every month until you edit or pause it.</small></label>}
        {((modalKind === 'Expense' && entryModeSelection === 'fixed') || (editing?.collection === 'recurring' && template?.kind === 'expense')) && <label>Monthly due day (1–31)<input name="dueDay" type="number" inputMode="numeric" min="1" max="31" step="1" defaultValue={defaultDueDay} /></label>}
        {modalKind === 'Expense' && entryModeSelection === 'fixed' && !editing && <div className="modal-note">Fixed expenses are added to Monthly fixed bills and default to the 10th of each month.</div>}
        {editing?.collection === 'recurring' && <div className="modal-note">Changes apply from the selected month forward. Earlier months keep their original values.</div>}
        <div className="form-row"><label>{modalKind === 'Payment' || modalKind === 'Task' ? 'Due date' : modalKind === 'Event' ? 'Event date' : modalKind === 'Expense' && entryModeSelection === 'fixed' ? 'Starts in month' : modalKind === 'Income' || modalKind === 'Expense' ? 'Date (year, month & day)' : 'Date'}<input name="date" type="date" defaultValue={defaultDate || today} /></label><label>Category<input name="category" required={modalKind === 'Income' || modalKind === 'Expense'} defaultValue={defaultCategory} placeholder={modalKind === 'Income' ? 'e.g. Salary, interest, rent' : modalKind === 'Expense' ? 'e.g. Groceries, utilities, medical' : 'Type your own category'} /></label></div>
        <label>Notes<textarea name="notes" rows={3} defaultValue={record?.notes || ''} placeholder="Add a note (optional)" /></label>
      </>}
      <div className="modal-note"><ShieldCheck size={15} /> Prototype records stay in this browser and are not encrypted.</div><div className="modal-actions"><button type="button" className="button subtle" onClick={() => { setModalKind(''); setEditing(null); }}>Cancel</button><button className="button primary" type="submit"><Check size={16} /> {editing ? 'Save changes' : `Save ${modalKind.toLowerCase()}`}</button></div>
    </form></div>}
  </div>;
}

function TaskRow({ item, complete, onEdit, onDelete, locked = false }: { item: Entry; complete: () => void; onEdit?: () => void; onDelete?: () => void; locked?: boolean }) { const overdue = Boolean(item.date && item.date < today && item.status !== 'Completed' && item.taskType !== 'event'); const dateText = item.taskType === 'event' ? (item.date ? `Event date · ${item.date}` : 'No event date') : !item.date ? 'No due date' : item.date === today ? 'Due today' : overdue ? `Overdue by ${daysOverdue(item.date)} ${daysOverdue(item.date) === 1 ? 'day' : 'days'}` : `${daysUntil(item.date)} days remaining`; return <div className={`task-row ${item.status === 'Completed' ? 'done' : ''}`}><button className="checkbox" onClick={complete}>{item.status === 'Completed' && <Check size={13} />}</button><div className="task-info"><strong>{locked ? 'Private planner item' : item.title}</strong><small className={overdue ? 'overdue-text' : ''}>{locked ? 'Unlock Planner to view details' : <><CalendarDays size={12} /> {dateText} · {item.status || 'Pending'}</>}</small></div><span className={`tag ${overdue ? 'tag-overdue' : 'tag-normal'}`}>{item.taskType === 'event' ? 'Event' : overdue ? 'Overdue' : item.status || 'Pending'}</span><RowActions onEdit={onEdit} onDelete={onDelete} /></div>; }
function PaymentRow({ item, privateMode, onEdit, onDelete }: { item: Entry; privateMode: boolean; onEdit: () => void; onDelete: () => void }) { return <div className="payment-row"><div className="pay-icon"><BadgeIndianRupee size={17} /></div><div className="pay-info"><strong>{item.title}</strong><small>{item.date} · {item.category} · {daysUntil(item.date!) === 0 ? 'Due today' : `${daysUntil(item.date!)} days remaining`}</small></div><div className="pay-amount">{privateMode ? money(item.amount) : '••••••'}</div><RowActions onEdit={onEdit} onDelete={onDelete} /></div>; }
function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) { return (onEdit || onDelete) ? <div className="record-actions">{onEdit && <button className="icon-button" title="Edit" aria-label="Edit" onClick={onEdit}><Pencil size={14} /></button>}{onDelete && <button className="icon-button delete-action" title="Delete" aria-label="Delete" onClick={onDelete}><Trash2 size={14} /></button>}</div> : null; }
function QuickAction({ icon, tone, title, subtitle, onClick }: { icon: React.ReactNode; tone: string; title: string; subtitle: string; onClick: () => void }) { return <button onClick={onClick}><span className={`quick-icon ${tone}`}>{icon}</span><span><b>{title}</b><small>{subtitle}</small></span><Plus size={15} /></button>; }
function FlowCard({ title, value, subtitle, tone, icon, active, onClick }: { title: string; value: string; subtitle: string; tone: string; icon: React.ReactNode; active: boolean; onClick: () => void }) { return <button className={`stat-card flow-card ${active ? 'flow-selected' : ''}`} onClick={onClick}><div className="stat-top">{title}<span className={`stat-icon ${tone}`}>{icon}</span></div><div className="stat-number">{value}</div><div className="stat-foot">{subtitle}</div></button>; }
function Metric({ title, amount, visible, tone, icon }: { title: string; amount: number; visible: boolean; tone: string; icon: React.ReactNode }) { return <article className="stat-card"><div className="stat-top">{title}<span className={`stat-icon ${tone}`}>{icon}</span></div><div className="stat-number">{visible ? money(amount) : '••••••'}</div></article>; }
function latestChange(template: RecurringTemplate, month: string) { const applicable = (template.changes || []).filter(change => change.fromMonth <= month).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth)); return applicable[applicable.length - 1]; }
function recurringDate(month: string, preferredDay: number) { const [year, monthNumber] = month.split('-').map(Number); const day = Math.min(Math.max(preferredDay, 1), new Date(year, monthNumber, 0).getDate()); return `${month}-${String(day).padStart(2, '0')}`; }
function previousMonth(month: string) { const [year, monthNumber] = month.split('-').map(Number); const date = new Date(year, monthNumber - 2, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function nextMonth(month: string) { const [year, monthNumber] = month.split('-').map(Number); const date = new Date(year, monthNumber, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function localDate(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
function shiftMonth(month: string, by: number) { const [year, monthNumber] = month.split('-').map(Number); const shifted = new Date(year, monthNumber - 1 + by, 1); return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`; }
function monthCount(from: string, to: string) { const [fromYear, fromMonth] = from.split('-').map(Number); const [toYear, toMonth] = to.split('-').map(Number); return Math.max(1, (toYear - fromYear) * 12 + toMonth - fromMonth + 1); }
function resizeRecurring(template: RecurringTemplate, fromMonth: string, duration?: number): RecurringTemplate {
  const previous = template.periods.filter(period => period.endMonth && period.endMonth < fromMonth);
  const current = template.periods.find(period => period.startMonth <= fromMonth && (!period.endMonth || fromMonth <= period.endMonth));
  if (current && current.startMonth < fromMonth) previous.push({ startMonth: current.startMonth, endMonth: previousMonth(fromMonth) });
  const nextPeriod = { startMonth: fromMonth, ...(duration ? { endMonth: shiftMonth(fromMonth, duration - 1) } : {}) };
  return { ...template, periods: [...previous, nextPeriod] };
}
function transactionsForMonth(data: Store, month: string): Entry[] {
  const oneTime = data.transactions.filter(item => item.date?.slice(0, 7) === month);
  const fixed = (data.recurringTemplates || []).flatMap(template => {
    if (!template.periods.some(period => period.startMonth <= month && (!period.endMonth || month <= period.endMonth))) return [];
    const change = latestChange(template, month);
    const category = change?.category || template.category;
    return [{ id: `fixed-${template.id}-${month}`, templateId: template.id, title: category, amount: change?.amount ?? template.amount, kind: template.kind, category, date: recurringDate(month, change?.dayOfMonth ?? template.dayOfMonth), entryMode: 'fixed' as const, paid: template.paidMonths?.includes(month) || false }];
  });
  return [...fixed, ...oneTime].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
function daysUntil(date: string) { const [year, month, day] = date.split('-').map(Number); const target = Date.UTC(year, month - 1, day); const [todayYear, todayMonth, todayDay] = today.split('-').map(Number); return Math.max(0, Math.round((target - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86400000)); }
function daysOverdue(date: string) { const [year, month, day] = date.split('-').map(Number); const target = Date.UTC(year, month - 1, day); const [todayYear, todayMonth, todayDay] = today.split('-').map(Number); return Math.max(1, Math.round((Date.UTC(todayYear, todayMonth - 1, todayDay) - target) / 86400000)); }

export default App;
