/**
 * POST /api/wizard/docs/financial-model/xlsx
 *
 * Produces a real .xlsx financial model with formulas (not prose). Three tabs:
 *   1) Assumptions   — editable inputs (unit econ, growth, hiring)
 *   2) P&L           — pulls from Assumptions via formulas
 *   3) Cash flow     — runway calculation via formulas
 *
 * Uses claude-opus-5 to propose realistic starting assumptions for THIS
 * specific business, then renders the workbook with exceljs.
 */

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { callWithRouting } from '../../../../../../lib/ai/call-with-routing';
import { readAuthedUser } from '../../../../../../lib/backend/session';
import { query } from '../../../../../../lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Req { idea?: unknown; productName?: unknown; research?: unknown; }

const ASSUMPTIONS_SYSTEM = `Given a founder's product idea, propose realistic starting assumptions for a 3-year financial model. Return STRICT JSON:

{
  "assumptions": {
    "arpuMonthly":      { "value": number, "unit": "USD",  "reasoning": string },
    "grossMarginPct":   { "value": number, "unit": "pct",  "reasoning": string },
    "monthlyChurnPct":  { "value": number, "unit": "pct",  "reasoning": string },
    "cacUsd":           { "value": number, "unit": "USD",  "reasoning": string },
    "startingCustomers":{ "value": number, "unit": "count","reasoning": string },
    "monthlyGrowthPct": { "value": number, "unit": "pct",  "reasoning": string },
    "monthlyFixedCosts":{ "value": number, "unit": "USD",  "reasoning": string },
    "openingCashUsd":   { "value": number, "unit": "USD",  "reasoning": string },
    "founderCountY1":   { "value": number, "unit": "count","reasoning": string },
    "founderCompY1":    { "value": number, "unit": "USD",  "reasoning": string },
    "hires":            [ { "role": string, "startMonth": number, "annualCompUsd": number, "reasoning": string } ]
  }
}

Rules:
- All numbers grounded in real 2024-2026 SaaS/consumer benchmarks for this category.
- reasoning is one short sentence per assumption citing a benchmark or source category.
- No fabrication — if you don't know a category-appropriate value, use industry-median with a clear reasoning note.`;

interface Assumption { value: number; unit: string; reasoning: string; }
interface Hire { role: string; startMonth: number; annualCompUsd: number; reasoning: string; }
interface AssumptionsPack {
  assumptions: {
    arpuMonthly: Assumption; grossMarginPct: Assumption; monthlyChurnPct: Assumption;
    cacUsd: Assumption; startingCustomers: Assumption; monthlyGrowthPct: Assumption;
    monthlyFixedCosts: Assumption; openingCashUsd: Assumption;
    founderCountY1: Assumption; founderCompY1: Assumption; hires: Hire[];
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Req;
  try { body = (await req.json()) as Req; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const productName = typeof body.productName === 'string' ? body.productName : 'Product';
  const research = typeof body.research === 'string' ? body.research : '';
  if (idea.length < 20) return NextResponse.json({ ok: false, error: 'idea_required' }, { status: 400 });

  const me = await readAuthedUser();
  const COST = 30;
  if (me && me.tokensBalance < COST) {
    return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: me.tokensBalance, cost: COST }, { status: 402 });
  }

  // 1) Assumptions from elite model
  const r = await callWithRouting('doc.financial-model', {
    systemPrompt: ASSUMPTIONS_SYSTEM,
    userPrompt: `Product: ${productName}\nIdea: "${idea}"\nResearch: ${research?.slice(0, 6000) || '(none)'}\n\nReturn the assumptions JSON now.`,
    responseFormat: 'json',
    maxTokens: 3_000,
    timeoutMs: 90_000,
  });
  if (!r.ok || !r.json) return NextResponse.json({ ok: false, error: 'llm_failed', detail: r.ok ? 'no_json' : r.error }, { status: 502 });
  const pack = r.json as AssumptionsPack;
  const a = pack.assumptions;

  // 2) Build workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CAIA';
  wb.created = new Date();

  // ── Assumptions tab ──
  const assump = wb.addWorksheet('Assumptions');
  assump.columns = [
    { header: 'Assumption', key: 'k', width: 32 },
    { header: 'Value',      key: 'v', width: 14 },
    { header: 'Unit',       key: 'u', width: 10 },
    { header: 'Reasoning',  key: 'r', width: 60 },
  ];
  assump.getRow(1).font = { bold: true };
  const rows: Array<[string, number, string, string]> = [
    ['ARPU (monthly)',            a.arpuMonthly.value,       a.arpuMonthly.unit,       a.arpuMonthly.reasoning],
    ['Gross margin %',            a.grossMarginPct.value,    a.grossMarginPct.unit,    a.grossMarginPct.reasoning],
    ['Monthly churn %',           a.monthlyChurnPct.value,   a.monthlyChurnPct.unit,   a.monthlyChurnPct.reasoning],
    ['CAC',                       a.cacUsd.value,            a.cacUsd.unit,            a.cacUsd.reasoning],
    ['Starting customers',        a.startingCustomers.value, a.startingCustomers.unit, a.startingCustomers.reasoning],
    ['Monthly growth %',          a.monthlyGrowthPct.value,  a.monthlyGrowthPct.unit,  a.monthlyGrowthPct.reasoning],
    ['Monthly fixed costs (ex-payroll)', a.monthlyFixedCosts.value, a.monthlyFixedCosts.unit, a.monthlyFixedCosts.reasoning],
    ['Opening cash',              a.openingCashUsd.value,    a.openingCashUsd.unit,    a.openingCashUsd.reasoning],
    ['Founder headcount Y1',      a.founderCountY1.value,    a.founderCountY1.unit,    a.founderCountY1.reasoning],
    ['Founder comp (annual)',     a.founderCompY1.value,     a.founderCompY1.unit,     a.founderCompY1.reasoning],
  ];
  for (const row of rows) assump.addRow(row);

  // Named ranges — so formulas reference `ARPU`, `CHURN`, etc.
  const NAMED = {
    ARPU: 'Assumptions!$B$2', GM: 'Assumptions!$B$3', CHURN: 'Assumptions!$B$4',
    CAC: 'Assumptions!$B$5', C0: 'Assumptions!$B$6', GROW: 'Assumptions!$B$7',
    FIX: 'Assumptions!$B$8', OPEN: 'Assumptions!$B$9',
    FCOUNT: 'Assumptions!$B$10', FCOMP: 'Assumptions!$B$11',
  };

  // Hires table
  assump.addRow([]);
  assump.addRow(['Hires (planned)']).font = { bold: true };
  assump.addRow(['Role', 'Start month (from month 1)', 'Annual comp (USD)', 'Reasoning']);
  for (const h of (a.hires || [])) {
    assump.addRow([h.role, h.startMonth, h.annualCompUsd, h.reasoning]);
  }

  // ── P&L tab (36 months) ──
  const pl = wb.addWorksheet('P&L');
  pl.getRow(1).font = { bold: true };
  const plHeaders = ['Metric', ...Array.from({ length: 36 }, (_, i) => `M${i + 1}`)];
  pl.addRow(plHeaders);
  pl.getColumn(1).width = 28;
  for (let c = 2; c <= 37; c++) pl.getColumn(c).width = 12;

  // Row 2: Customers  — C_n = C_(n-1) * (1 + GROW) - C_(n-1)*CHURN
  const custRow = 2;
  const revRow = 3, cogsRow = 4, gpRow = 5, payrollRow = 6, marketingRow = 7, fixedRow = 8, opexRow = 9, ebitdaRow = 10, ebitdaMarginRow = 11;
  const rowLabels = [
    'Customers', 'Revenue', 'COGS', 'Gross Profit',
    'Payroll (founders + hires)', 'Marketing (CAC×new)', 'Fixed costs', 'Total Opex', 'EBITDA', 'EBITDA margin',
  ];
  for (let i = 0; i < rowLabels.length; i++) {
    pl.getCell(2 + i, 1).value = rowLabels[i];
    pl.getCell(2 + i, 1).font = { bold: true };
  }

  for (let m = 1; m <= 36; m++) {
    const col = m + 1; // month M1 = column B (=2)
    // Customers
    if (m === 1) {
      pl.getCell(custRow, col).value = { formula: NAMED.C0 } as ExcelJS.CellFormulaValue;
    } else {
      const prev = pl.getCell(custRow, col - 1).address;
      pl.getCell(custRow, col).value = { formula: `${prev}*(1+${NAMED.GROW}/100)-${prev}*${NAMED.CHURN}/100`, result: 0 } as ExcelJS.CellFormulaValue;
    }
    // Revenue = Customers * ARPU
    pl.getCell(revRow, col).value = { formula: `${pl.getCell(custRow, col).address}*${NAMED.ARPU}`, result: 0 } as ExcelJS.CellFormulaValue;
    // COGS = Revenue * (1 - GM/100)
    pl.getCell(cogsRow, col).value = { formula: `${pl.getCell(revRow, col).address}*(1-${NAMED.GM}/100)`, result: 0 } as ExcelJS.CellFormulaValue;
    // Gross Profit
    pl.getCell(gpRow, col).value = { formula: `${pl.getCell(revRow, col).address}-${pl.getCell(cogsRow, col).address}`, result: 0 } as ExcelJS.CellFormulaValue;
    // Payroll — founders + hires whose startMonth ≤ m
    const hireCost = (a.hires || []).filter((h) => h.startMonth <= m).reduce((sum, h) => sum + h.annualCompUsd / 12, 0);
    pl.getCell(payrollRow, col).value = { formula: `(${NAMED.FCOUNT}*${NAMED.FCOMP}/12)+${hireCost}`, result: 0 } as ExcelJS.CellFormulaValue;
    // Marketing = new customers * CAC — new = Cn - Cn-1 (only if > 0)
    if (m === 1) {
      pl.getCell(marketingRow, col).value = 0;
    } else {
      const prev = pl.getCell(custRow, col - 1).address;
      const now = pl.getCell(custRow, col).address;
      pl.getCell(marketingRow, col).value = { formula: `MAX(0,${now}-${prev})*${NAMED.CAC}`, result: 0 } as ExcelJS.CellFormulaValue;
    }
    // Fixed
    pl.getCell(fixedRow, col).value = { formula: NAMED.FIX } as ExcelJS.CellFormulaValue;
    // Total opex
    pl.getCell(opexRow, col).value = { formula: `${pl.getCell(payrollRow, col).address}+${pl.getCell(marketingRow, col).address}+${pl.getCell(fixedRow, col).address}`, result: 0 } as ExcelJS.CellFormulaValue;
    // EBITDA
    pl.getCell(ebitdaRow, col).value = { formula: `${pl.getCell(gpRow, col).address}-${pl.getCell(opexRow, col).address}`, result: 0 } as ExcelJS.CellFormulaValue;
    // EBITDA margin
    pl.getCell(ebitdaMarginRow, col).value = { formula: `IFERROR(${pl.getCell(ebitdaRow, col).address}/${pl.getCell(revRow, col).address},0)`, result: 0 } as ExcelJS.CellFormulaValue;
    pl.getCell(ebitdaMarginRow, col).numFmt = '0.0%';
  }
  // Currency formatting for USD rows
  for (const r of [revRow, cogsRow, gpRow, payrollRow, marketingRow, fixedRow, opexRow, ebitdaRow]) {
    for (let c = 2; c <= 37; c++) pl.getCell(r, c).numFmt = '$#,##0';
  }

  // ── Cash Flow tab ──
  const cf = wb.addWorksheet('Cash Flow');
  cf.columns = [{ header: 'Metric', key: 'k', width: 22 }, ...Array.from({ length: 36 }, (_, i) => ({ header: `M${i + 1}`, key: `m${i + 1}`, width: 12 }))];
  cf.getRow(1).font = { bold: true };
  cf.addRow(['EBITDA']);
  cf.addRow(['Opening cash']);
  cf.addRow(['Closing cash']);
  cf.addRow(['Runway (months at burn)']);
  for (let m = 1; m <= 36; m++) {
    const col = m + 1;
    // EBITDA = pull from P&L
    cf.getCell(2, col).value = { formula: `'P&L'!${pl.getCell(ebitdaRow, col).address}`, result: 0 } as ExcelJS.CellFormulaValue;
    // Opening cash
    if (m === 1) cf.getCell(3, col).value = { formula: NAMED.OPEN } as ExcelJS.CellFormulaValue;
    else cf.getCell(3, col).value = { formula: cf.getCell(4, col - 1).address, result: 0 } as ExcelJS.CellFormulaValue;
    // Closing = opening + EBITDA
    cf.getCell(4, col).value = { formula: `${cf.getCell(3, col).address}+${cf.getCell(2, col).address}`, result: 0 } as ExcelJS.CellFormulaValue;
    // Runway = -closing / avg burn (only if burning)
    cf.getCell(5, col).value = { formula: `IF(${cf.getCell(2, col).address}<0, ${cf.getCell(4, col).address}/(-${cf.getCell(2, col).address}), "profitable")`, result: 0 } as ExcelJS.CellFormulaValue;
  }
  for (const r of [2, 3, 4]) for (let c = 2; c <= 37; c++) cf.getCell(r, c).numFmt = '$#,##0';

  // 3) Write & respond
  const buf = await wb.xlsx.writeBuffer();

  let newBalance: number | undefined;
  if (me) {
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance - $2, updated_at = NOW() WHERE id = $1', [me.id, COST]);
    await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, $2, 'spend:doc:financial-model-xlsx')", [me.id, -COST]);
    newBalance = me.tokensBalance - COST;
  }

  const filename = `${productName.toLowerCase().replace(/\s+/g, '-')}-financial-model.xlsx`;
  return new NextResponse(Buffer.from(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'x-tokens-balance': String(newBalance ?? ''),
      'x-model': r.model,
    },
  });
}
