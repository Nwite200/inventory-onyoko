import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type JournalLine } from '../db';
import { formatMoney } from '../config';
import { listLocations } from '../location';
import {
  CHART_OF_ACCOUNTS,
  accountLedger,
  balanceSheet,
  currentOperator,
  journalTotals,
  loadLedger,
  postJournal,
  profitAndLoss,
  reverseJournal,
  trialBalance,
  type LedgerRow,
} from '../accounting';
import { Icon } from '../components/Icon';
import { Meter } from '../components/charts';
import { downloadExcel } from '../export';
import { requestApproval, APPROVAL_REQUIRED } from '../approvals';

type Tab = 'overview' | 'accounts' | 'journal' | 'reports';
type Report = 'pl' | 'balance' | 'trial' | 'ledger';

const TYPE_LABEL: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

const money = (n: number): string => formatMoney(Math.round(n * 100) / 100);
const dateLabel = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dayInput = (at: number): string => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Parses a yyyy-mm-dd control value in local time (new Date('yyyy-mm-dd') is UTC and can slip a day). */
const parseLocalDay = (text: string, endOfDay = false): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return undefined;
  const d = endOfDay
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
};

function startOfMonth(at = Date.now()): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Accounting({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [report, setReport] = useState<Report>('pl');
  const [period, setPeriod] = useState<'month' | '30' | 'all' | 'custom'>('month');
  const [fromText, setFromText] = useState(dayInput(startOfMonth()));
  const [toText, setToText] = useState(dayInput(Date.now()));
  const [journalOpen, setJournalOpen] = useState(false);
  const [branch, setBranch] = useState('all');

  const ledger = useLiveQuery(async () => loadLedger(branch === 'all' ? null : branch), [branch]);
  const manuals = useLiveQuery(() => db.journals.orderBy('date').reverse().toArray(), [], []);
  const locations = useLiveQuery(async () => listLocations(), [], []);

  const range = useMemo(() => {
    const to = parseLocalDay(toText, true) ?? Date.now();
    let from: number | undefined;
    if (period === 'month') from = startOfMonth();
    else if (period === '30') from = Date.now() - 30 * 86_400_000;
    else if (period === 'custom') from = parseLocalDay(fromText);
    return { from, to: period === 'all' ? undefined : to };
  }, [period, fromText, toText]);

  const pl = useMemo(() => (ledger ? profitAndLoss(ledger, range.from, range.to) : null), [ledger, range]);
  const bs = useMemo(() => (ledger ? balanceSheet(ledger, range.to ?? Date.now() + 1) : null), [ledger, range]);
  const tb = useMemo(() => (ledger ? trialBalance(ledger, range.from, range.to) : null), [ledger, range]);
  const cashRow = tb?.rows.find((r) => r.code === '1010');
  const bankRow = tb?.rows.find((r) => r.code === '1020');
  const recent = useMemo(() => (ledger ? [...ledger].sort((a, b) => b.date - a.date).slice(0, 10) : []), [ledger]);

  const [ledgerAccount, setLedgerAccount] = useState('1010');
  const ledgerRows: LedgerRow[] = useMemo(
    () => (ledger ? accountLedger(ledger, ledgerAccount, range.from, range.to) : []),
    [ledger, ledgerAccount, range],
  );

  const exportVisible = () => {
    if (report === 'pl' && pl) {
      downloadCsv('profit-and-loss.csv', [
        ['Profit and loss', ''],
        ['Revenue', pl.revenue],
        ['Returns', -pl.returns],
        ['Net revenue', pl.netRevenue],
        ['Cost of goods sold', -pl.cogs],
        ['Inventory adjustments', -pl.inventoryAdjustments],
        ['Gross profit', pl.grossProfit],
        ...pl.expenseRows.map((r) => [r.name, -r.balance] as (string | number)[]),
        ['Net profit', pl.netProfit],
      ]);
    } else if (report === 'trial' && tb) {
      downloadCsv('trial-balance.csv', [['Code', 'Account', 'Debit', 'Credit'], ...tb.rows.map((r) => [r.code, r.name, r.debit, r.credit]), ['', 'Total', tb.totalDebit, tb.totalCredit]]);
    } else if (report === 'balance' && bs) {
      downloadCsv('balance-sheet.csv', [
        ['Assets', ''],
        ...bs.assets.map((r) => [r.name, r.balance] as (string | number)[]),
        ['Total assets', bs.totalAssets],
        ['Liabilities', ''],
        ...bs.liabilities.map((r) => [r.name, r.balance] as (string | number)[]),
        ['Equity', ''],
        ...bs.equity.map((r) => [r.name, r.balance] as (string | number)[]),
        ['Current earnings', bs.earnings],
      ]);
    } else if (report === 'ledger') {
      downloadCsv(`ledger-${ledgerAccount}.csv`, [['Date', 'Reference', 'Memo', 'Debit', 'Credit', 'Balance'], ...ledgerRows.map((r) => [new Date(r.date).toISOString().slice(0, 10), r.ref, r.memo, r.debit, r.credit, r.balance])]);
    }
  };

  return (
    <div className="accounting">
      <header className="page-head">
        <div>
          <span className="eyebrow">Finance</span>
          <h1>Accounting</h1>
          <p className="lede">Double-entry ledger built from your sales, purchases, expenses and refunds.</p>
        </div>
        <div className="page-head-actions">
          {locations.length > 1 && (
            <label className="select-wrap">
              <Icon name="store" size={15} />
              <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
                <option value="all">All branches</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          <div className="segmented" role="group" aria-label="Section">
            {([['overview', 'Overview'], ['accounts', 'Chart of accounts'], ['journal', 'Journal'], ['reports', 'Statements']] as [Tab, string][]).map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setJournalOpen(true)}>
              <Icon name="plus" size={16} /> New journal
            </button>
          )}
        </div>
      </header>

      {!ledger || !pl || !bs || !tb ? (
        <div className="skeleton-grid">{Array.from({ length: 3 }, (_, i) => <div className="skeleton-card" key={i} />)}</div>
      ) : (
        <>
          {tab === 'overview' && (
            <>
              <section className="kpi-grid">
                <article className="kpi-card">
                  <div className="kpi-top"><span className="kpi-label">Net revenue</span><span className="kpi-ico"><Icon name="banknote" size={16} /></span></div>
                  <div className="kpi-value">{money(pl.netRevenue)}</div>
                  <div className="kpi-foot"><span className="kpi-context">Gross sales {money(pl.revenue)} · returns {money(pl.returns)}</span></div>
                </article>
                <article className="kpi-card">
                  <div className="kpi-top"><span className="kpi-label">Gross profit</span><span className="kpi-ico ico-emerald"><Icon name="trendUp" size={16} /></span></div>
                  <div className="kpi-value">{money(pl.grossProfit)}</div>
                  <div className="kpi-foot"><span className="kpi-context">COGS {money(pl.cogs + pl.inventoryAdjustments)}</span></div>
                </article>
                <article className="kpi-card">
                  <div className="kpi-top"><span className="kpi-label">Net profit</span><span className={`kpi-ico ${pl.netProfit < 0 ? 'ico-rose' : 'ico-amber'}`}><Icon name="wallet" size={16} /></span></div>
                  <div className="kpi-value">{money(pl.netProfit)}</div>
                  <div className="kpi-foot"><span className="kpi-context">Operating expenses {money(pl.expenses)}</span></div>
                </article>
                <article className="kpi-card">
                  <div className="kpi-top"><span className="kpi-label">Cash & bank</span><span className="kpi-ico ico-sky"><Icon name="register" size={16} /></span></div>
                  <div className="kpi-value">{money((cashRow?.balance ?? 0) + (bankRow?.balance ?? 0))}</div>
                  <div className="kpi-foot"><span className="kpi-context">Cash {money(cashRow?.balance ?? 0)} · bank {money(bankRow?.balance ?? 0)}</span></div>
                </article>
              </section>

              <section className="dashboard-main">
                <article className="panel">
                  <header className="panel-head">
                    <div><h3>Recent postings</h3><p className="panel-sub">Newest entries in the ledger</p></div>
                    <span className={`badge ${tb.balanced ? 'badge-success' : 'badge-danger'}`}>{tb.balanced ? 'Trial balance in balance' : 'Out of balance'}</span>
                  </header>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th>Date</th><th>Entry</th><th>Source</th><th className="num">Amount</th></tr></thead>
                      <tbody>
                        {recent.map((e) => (
                          <tr key={e.id}>
                            <td className="muted">{dateLabel(e.date)}</td>
                            <td><strong>{e.memo}</strong><div className="muted small">{e.ref}</div></td>
                            <td><span className="badge badge-subtle">{e.source}</span></td>
                            <td className="num">{money(e.lines.filter((l) => l.debit > 0).reduce((s, l) => s + l.debit, 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>

                <article className="panel">
                  <header className="panel-head"><div><h3>Balance check</h3><p className="panel-sub">Assets = liabilities + equity</p></div></header>
                  <ul className="balance-list">
                    <li><span>Total assets</span><strong>{money(bs.totalAssets)}</strong></li>
                    <li><span>Total liabilities</span><strong>{money(bs.totalLiabilities)}</strong></li>
                    <li><span>Equity</span><strong>{money(bs.totalEquity)}</strong></li>
                    <li><span>Current earnings</span><strong>{money(bs.earnings)}</strong></li>
                    <li className="balance-total"><span>Difference</span><strong className={Math.abs(bs.difference) < 0.01 ? 'text-success' : 'text-danger'}>{money(bs.difference)}</strong></li>
                  </ul>
                  <p className="panel-note">
                    <Icon name="check" size={14} /> Every derived entry is balanced. Stock is valued at the cost captured when it moved.
                  </p>
                  <div className="ratio-grid">
                    <div><span>Gross margin</span><strong>{pl.netRevenue ? ((pl.grossProfit / pl.netRevenue) * 100).toFixed(1) : '0.0'}%</strong></div>
                    <div><span>Net margin</span><strong>{pl.netRevenue ? ((pl.netProfit / pl.netRevenue) * 100).toFixed(1) : '0.0'}%</strong></div>
                    <div><span>Refund rate</span><strong>{pl.revenue ? ((pl.returns / pl.revenue) * 100).toFixed(1) : '0.0'}%</strong></div>
                  </div>
                  {bs.assets.some((a) => a.balance > 0) && (
                    <div className="asset-mix">
                      <div className="mix-head">Asset mix</div>
                      {bs.assets.filter((a) => a.balance > 0).map((a, i) => (
                        <div className="mix-row" key={a.code}>
                          <span>{a.name}</span>
                          <Meter value={a.balance} max={Math.max(...bs.assets.map((x) => x.balance), 1)} tone={i === 0 ? 'emerald' : 'primary'} />
                          <strong>{money(a.balance)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              </section>
            </>
          )}

          {tab === 'accounts' && (
            <section className="panel">
              <header className="panel-head">
                <div><h3>Chart of accounts</h3><p className="panel-sub">{CHART_OF_ACCOUNTS.length} accounts across assets, liabilities, equity, income and expenses</p></div>
              </header>
              <div className="coa-grid">
                {(['asset', 'liability', 'equity', 'income', 'expense'] as const).map((type) => (
                  <div className="coa-group" key={type}>
                    <h4>{TYPE_LABEL[type]}</h4>
                    <ul>
                      {CHART_OF_ACCOUNTS.filter((a) => a.type === type).map((a) => {
                        const row = tb.rows.find((r) => r.code === a.code);
                        return (
                          <li key={a.code}>
                            <span className="coa-code">{a.code}</span>
                            <span className="coa-name">{a.name}<small>{a.group}</small></span>
                            <span className="coa-balance">{row ? money(row.balance) : '—'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'journal' && (
            <section className="panel">
              <header className="panel-head">
                <div><h3>Manual journals</h3><p className="panel-sub">Adjustments, accruals and corrections. Posted entries are never edited.</p></div>
                {canManage && <button className="btn btn-secondary btn-sm" onClick={() => setJournalOpen(true)}><Icon name="plus" size={14} /> New journal</button>}
              </header>
              {manuals.length === 0 ? (
                <div className="empty-state"><span className="empty-ico"><Icon name="clipboard" size={22} /></span><strong>No manual journals</strong><p>Sales, purchases, expenses and refunds post automatically. Add a journal only for adjustments.</p></div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Number</th><th>Date</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th /></tr></thead>
                    <tbody>
                      {manuals.map((j) => (
                        <tr key={j.id}>
                          <td className="fw-mono">{j.number}</td>
                          <td className="muted">{dateLabel(j.date)}</td>
                          <td><strong>{j.memo}</strong><div className="muted small">{j.lines.map((l) => `${l.account} ${l.debit ? `Dr ${money(l.debit)}` : `Cr ${money(l.credit)}`}`).join(' · ')}</div></td>
                          <td className="num">{money(journalTotals(j.lines).debit)}</td>
                          <td className="num">{money(journalTotals(j.lines).credit)}</td>
                          <td>
                            {canManage && !j.reverses && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={async () => {
                                  try {
                                    await reverseJournal(j.id, currentOperator());
                                  } catch (e) {
                                    alert(e instanceof Error ? e.message : 'Could not reverse');
                                  }
                                }}
                              >
                                Reverse
                              </button>
                            )}
                            {j.reverses && <span className="badge badge-subtle">Reversal</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'reports' && (
            <>
              <div className="report-toolbar">
                <div className="segmented">
                  {([['pl', 'Profit & loss'], ['balance', 'Balance sheet'], ['trial', 'Trial balance'], ['ledger', 'Account ledger']] as [Report, string][]).map(([id, label]) => (
                    <button key={id} className={report === id ? 'active' : ''} onClick={() => setReport(id)}>{label}</button>
                  ))}
                </div>
                <div className="report-dates">
                  <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} aria-label="Period">
                    <option value="month">This month</option>
                    <option value="30">Last 30 days</option>
                    <option value="all">All time</option>
                    <option value="custom">Custom</option>
                  </select>
                  {period === 'custom' && (
                    <>
                      <input type="date" value={fromText} onChange={(e) => setFromText(e.target.value)} aria-label="From" />
                      <span className="muted">to</span>
                      <input type="date" value={toText} onChange={(e) => setToText(e.target.value)} aria-label="To" />
                    </>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={exportVisible}><Icon name="download" size={14} /> CSV</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { if (tb) downloadExcel('trial-balance', 'Trial balance', [['Code', 'Account', 'Debit', 'Credit'], ...tb.rows.map((r) => [r.code, r.name, r.debit, r.credit]), ['', 'Total', tb.totalDebit, tb.totalCredit]]); }}><Icon name="download" size={14} /> Excel</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => window.print()}><Icon name="printer" size={14} /> PDF</button>
                </div>
              </div>

              {report === 'pl' && (
                <section className="panel statement">
                  <header className="statement-head"><div><span className="eyebrow">Statement</span><h2>Profit & loss</h2><p className="panel-sub">{period === 'all' ? 'All time' : `${dateLabel(range.from ?? Date.now())} — ${dateLabel(range.to ?? Date.now())}`}</p></div></header>
                  <div className="statement-body">
                    <div className="stmt-row"><span>Sales revenue</span><span>{money(pl.revenue)}</span></div>
                    <div className="stmt-row"><span>Less returns & refunds</span><span>({money(pl.returns)})</span></div>
                    <div className="stmt-row strong"><span>Net revenue</span><span>{money(pl.netRevenue)}</span></div>
                    <div className="stmt-row"><span>Cost of goods sold</span><span>({money(pl.cogs)})</span></div>
                    <div className="stmt-row"><span>Inventory adjustments</span><span>({money(pl.inventoryAdjustments)})</span></div>
                    <div className="stmt-row strong"><span>Gross profit</span><span>{money(pl.grossProfit)}</span></div>
                    <div className="stmt-section">Operating expenses</div>
                    {pl.expenseRows.length === 0 ? <div className="stmt-row muted"><span>No expenses in this period</span><span>—</span></div> : pl.expenseRows.map((r) => (
                      <div className="stmt-row" key={r.code}><span>{r.name}</span><span>({money(r.balance)})</span></div>
                    ))}
                    <div className="stmt-row strong total"><span>Net profit</span><span>{money(pl.netProfit)}</span></div>
                  </div>
                </section>
              )}

              {report === 'balance' && (
                <section className="panel statement">
                  <header className="statement-head"><div><span className="eyebrow">Statement</span><h2>Balance sheet</h2><p className="panel-sub">As at {dateLabel(range.to ?? Date.now())}</p></div>
                    <span className={`badge ${Math.abs(bs.difference) < 0.01 ? 'badge-success' : 'badge-danger'}`}>{Math.abs(bs.difference) < 0.01 ? 'Balanced' : `Off by ${money(bs.difference)}`}</span>
                  </header>
                  <div className="statement-body">
                    <div className="stmt-section">Assets</div>
                    {bs.assets.map((r) => <div className="stmt-row" key={r.code}><span>{r.name}</span><span>{money(r.balance)}</span></div>)}
                    <div className="stmt-row strong"><span>Total assets</span><span>{money(bs.totalAssets)}</span></div>
                    <div className="stmt-section">Liabilities</div>
                    {bs.liabilities.length === 0 ? <div className="stmt-row muted"><span>None</span><span>—</span></div> : bs.liabilities.map((r) => <div className="stmt-row" key={r.code}><span>{r.name}</span><span>{money(r.balance)}</span></div>)}
                    <div className="stmt-row strong"><span>Total liabilities</span><span>{money(bs.totalLiabilities)}</span></div>
                    <div className="stmt-section">Equity</div>
                    {bs.equity.map((r) => <div className="stmt-row" key={r.code}><span>{r.name}</span><span>{money(r.balance)}</span></div>)}
                    <div className="stmt-row"><span>Current earnings</span><span>{money(bs.earnings)}</span></div>
                    <div className="stmt-row strong total"><span>Total liabilities & equity</span><span>{money(bs.totalLiabilities + bs.totalEquity + bs.earnings)}</span></div>
                  </div>
                </section>
              )}

              {report === 'trial' && (
                <section className="panel statement">
                  <header className="statement-head"><div><span className="eyebrow">Statement</span><h2>Trial balance</h2><p className="panel-sub">All accounts with movement in the period</p></div>
                    <span className={`badge ${tb.balanced ? 'badge-success' : 'badge-danger'}`}>{tb.balanced ? 'Debits = credits' : 'Out of balance'}</span>
                  </header>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th>Code</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                      <tbody>
                        {tb.rows.map((r) => (
                          <tr key={r.code}><td className="fw-mono">{r.code}</td><td>{r.name}</td><td className="num">{money(r.debit)}</td><td className="num">{money(r.credit)}</td><td className="num">{money(r.balance)}</td></tr>
                        ))}
                        <tr className="row-total"><td /><td>Total</td><td className="num">{money(tb.totalDebit)}</td><td className="num">{money(tb.totalCredit)}</td><td /></tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {report === 'ledger' && (
                <section className="panel statement">
                  <header className="statement-head">
                    <div><span className="eyebrow">Detail</span><h2>Account ledger</h2><p className="panel-sub">Every posting for one account, with a running balance</p></div>
                    <select value={ledgerAccount} onChange={(e) => setLedgerAccount(e.target.value)} aria-label="Account">
                      {CHART_OF_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                    </select>
                  </header>
                  {ledgerRows.length === 0 ? (
                    <div className="empty-state compact"><p>No postings for this account in the selected period.</p></div>
                  ) : (
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead><tr><th>Date</th><th>Ref</th><th>Memo</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                        <tbody>
                          {ledgerRows.map((r, i) => (
                            <tr key={`${r.date}-${i}`}><td className="muted">{dateLabel(r.date)}</td><td className="fw-mono">{r.ref}</td><td>{r.memo}</td><td className="num">{money(r.debit)}</td><td className="num">{money(r.credit)}</td><td className="num">{money(r.balance)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}

      {journalOpen && <JournalModal onClose={() => setJournalOpen(false)} />}
    </div>
  );
}

function JournalModal({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(dayInput(Date.now()));
  const [memo, setMemo] = useState('');
  const [approvalKey] = useState(() => uid());
  const [lines, setLines] = useState<JournalLine[]>([
    { account: '1010', debit: 0, credit: 0 },
    { account: '3000', debit: 0, credit: 0 },
  ]);
  const [error, setError] = useState('');
  const totals = journalTotals(lines);

  const update = (i: number, patch: Partial<JournalLine>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await postJournal({
        date: new Date(`${date}T12:00:00`).getTime(),
        memo,
        lines,
        createdBy: currentOperator(),
        approvalKey,
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not post the journal';
      if (message.startsWith(APPROVAL_REQUIRED)) {
        try {
          await requestApproval({ kind: 'journal', entityId: approvalKey, summary: `Journal — ${memo}`, amount: totals.debit });
          setError('Approval requested. A manager can approve it in Advanced → Approvals, then post again.');
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : message);
        }
      } else {
        setError(message);
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-large" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New journal">
        <form onSubmit={submit}>
          <header className="modal-header">
            <h3>New journal entry</h3>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
          </header>
          <div className="modal-body">
            {error && <div className="alert-error" role="alert">{error}</div>}
            <div className="form-grid two-col">
              <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
              <label className="field"><span>Description</span><input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Owner capital introduced" required /></label>
            </div>
            <table className="journal-lines">
              <thead><tr><th>Account</th><th>Debit</th><th>Credit</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select value={l.account} onChange={(e) => update(i, { account: e.target.value })} aria-label={`Account line ${i + 1}`}>
                        {CHART_OF_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" min="0" step="0.01" value={l.debit || ''} onChange={(e) => update(i, { debit: Number(e.target.value), credit: 0 })} aria-label={`Debit line ${i + 1}`} /></td>
                    <td><input type="number" min="0" step="0.01" value={l.credit || ''} onChange={(e) => update(i, { credit: Number(e.target.value), debit: 0 })} aria-label={`Credit line ${i + 1}`} /></td>
                    <td>
                      <button type="button" className="icon-btn" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))} disabled={lines.length <= 2} aria-label="Remove line">
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><button type="button" className="link-btn" onClick={() => setLines((ls) => [...ls, { account: '6100', debit: 0, credit: 0 }])}>+ Add line</button></td>
                  <td className="num"><strong>{money(totals.debit)}</strong></td>
                  <td className="num"><strong>{money(totals.credit)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <p className={`journal-check ${totals.balanced ? 'ok' : ''}`}>
              <Icon name={totals.balanced ? 'check' : 'alert'} size={14} />
              {totals.balanced ? 'Debits and credits are balanced.' : `Difference: ${money(Math.abs(totals.debit - totals.credit))}`}
            </p>
          </div>
          <footer className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!totals.balanced || !memo.trim() || !canPost(lines)}>Post journal</button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function canPost(lines: JournalLine[]): boolean {
  return lines.every((l) => l.account && ((l.debit > 0 && !l.credit) || (l.credit > 0 && !l.debit)));
}
