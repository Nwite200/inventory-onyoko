import { SalesDocuments } from './SalesDocuments';

export function Quotations() {
  return (
    <div className="quotations-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Sales pipeline</span>
          <h1>Quotations &amp; sales orders</h1>
          <p className="lede">Prepare customer documents, print them, then convert to a sale when the customer commits. Stock moves only on conversion.</p>
        </div>
      </header>
      <SalesDocuments />
    </div>
  );
}
