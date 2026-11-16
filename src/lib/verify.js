// Turns raw counts from Woo and HubSpot into the numbers the README / case study quote,
// plus a list of problems (duplicates, missing deals). Used by scripts/verify-hubspot.mjs.

export function verifyReport({ wooOrders, deals, stageIds, contacts, companies, needsReview, tickets }) {
  const ids = deals.map((d) => d.properties.woo_order_id);
  const distinct = new Set(ids).size;
  const duplicates = ids.length - distinct;
  const won = deals.filter((d) => d.properties.dealstage === stageIds.closedwon);
  const revenue = Math.round(won.reduce((s, d) => s + Number(d.properties.amount || 0), 0) * 100) / 100;

  const problems = [];
  if (duplicates) problems.push(`${duplicates} duplicate woo_order_id`);
  if (distinct !== wooOrders) problems.push(`Woo has ${wooOrders} orders but HubSpot has ${distinct} distinct deals`);

  return {
    orders_in_woo: wooOrders,
    deals_in_hubspot: deals.length,
    duplicate_woo_order_ids: duplicates,
    contacts,
    companies,
    needs_review_contacts: needsReview,
    integration_error_tickets: tickets,
    closed_won_deals: won.length,
    closed_won_revenue: revenue,
    average_order_value: won.length ? Math.round((revenue / won.length) * 100) / 100 : 0,
    problems,
  };
}
