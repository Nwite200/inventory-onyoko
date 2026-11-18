import type { Sale } from '../db';
import { config, formatMoney } from '../config';
import { QrCode } from './QrCode';
import { Icon } from './Icon';

/** A4 customer invoice, using the live white-label branding. */
export function Invoice({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const b = config.branding;
  const subtotal = sale.subtotal ?? sale.total;
  return (
    <div className="modal-backdrop invoice-backdrop" onClick={onClose}>
      <div className="invoice-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Invoice">
        <div className="invoice-modal-bar no-print">
          <span><strong>Invoice</strong> · {sale.number}</span>
          <div className="row-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => window.print()}><Icon name="printer" size={14} /> Print / PDF</button>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
          </div>
        </div>
        <div className="invoice-paper invoice-print">
          <div className="invoice-head">
            <div className="invoice-brand">
              {b.showLogo && (b.logo || b.loginLogo) && <img src={b.logo || b.loginLogo} alt="" />}
              <div>
                <h2>{b.businessName || config.appName}</h2>
                {b.address && <p>{b.address}</p>}
                {b.phone && <p>{b.phone}</p>}
                {b.email && <p>{b.email}</p>}
                {b.website && <p>{b.website}</p>}
              </div>
            </div>
            <div className="invoice-title">
              <span>INVOICE</span>
              <strong>{sale.number}</strong>
              <p>{new Date(sale.at).toLocaleDateString(config.locale)}</p>
              {sale.cashier && <p>Cashier: {sale.cashier}</p>}
            </div>
          </div>
          <div className="invoice-parties">
            <div><span>Bill to</span><strong>{sale.customerName}</strong><p>{sale.payment === 'credit' ? 'Credit account' : 'Paid in full'}</p></div>
            <div><span>Payment</span><strong>{sale.payment}</strong><p>{sale.payments?.map((p) => `${p.method} ${formatMoney(p.amount)}`).join(' · ') || 'Single tender'}</p></div>
          </div>
          <table className="invoice-table">
            <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
            <tbody>
              {sale.items.map((it, i) => (
                <tr key={`${it.productId}-${i}`}>
                  <td>{it.name}{it.serials?.length ? <div className="muted small">Serials: {it.serials.join(', ')}</div> : null}</td>
                  <td>{it.qty}</td>
                  <td>{formatMoney(it.price)}</td>
                  <td>{formatMoney(it.qty * it.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="invoice-totals">
            <div><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
            {(sale.discount ?? 0) > 0 && <div><span>Discount</span><span>−{formatMoney(sale.discount ?? 0)}</span></div>}
            {b.showTax && (sale.tax ?? 0) > 0 && <div><span>Tax</span><span>{formatMoney(sale.tax ?? 0)}</span></div>}
            <div className="grand"><span>Total</span><span>{formatMoney(sale.total)}</span></div>
          </div>
          <div className="invoice-foot">
            <div><span>Terms</span><p>{b.invoiceTerms}</p><span>Note</span><p>{b.footer}</p></div>
            {b.showQr && <QrCode text={b.qrText || `${b.website || config.appName}/${sale.number}`} size={92} />}
          </div>
        </div>
      </div>
    </div>
  );
}
