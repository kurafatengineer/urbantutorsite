// The money side of a running class ("deal", stored in applications.billing_plan.deal).
// Two ways the agency earns from a tuition:
//
//   commission - a monthly deal (classes a month, monthly fee). The agency takes
//                a cut (% or a fixed amount) of the FIRST month's fee, from the
//                tutor, once - after that the tuition is between parent and tutor.
//                The first month's fee goes either to the tutor (who then pays the
//                cut) or to the agency (which keeps the cut and pays the rest on).
//   margin     - per class: the parent pays the agency a price per class, the agency
//                keeps a margin (% or amount) and pays the tutor the rest, every month.
//
// The same maths lives in js/pages/admin.js (dealNumbers) for the Admin Panel.

export type Deal = {
  model?: string; minutes?: number | string; time?: string;
  parentFreq?: string; tutorFreq?: string;
  monthlyFee?: number | string; feeTo?: string; cutType?: string; cutValue?: number | string;
  parentPerClass?: number | string; marginType?: string; marginValue?: number | string;
  finalizedAt?: string; agreementSentAt?: string;
};

export const FREQ_PER_MONTH: Record<string, number> = { "Weekly": 4, "15 Days": 2, "Monthly": 1 };

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r = (v: number) => Math.round(v);

export function dealNumbers(deal: Deal, classes: number) {
  const minutes = n(deal.minutes);
  const hours = classes * minutes / 60;
  const pK = FREQ_PER_MONTH[deal.parentFreq ?? ""] ?? 1;
  const tK = FREQ_PER_MONTH[deal.tutorFreq ?? ""] ?? 1;

  if (deal.model === "margin") {
    const parentPerClass = n(deal.parentPerClass);
    const margin = deal.marginType === "percent" ? parentPerClass * n(deal.marginValue) / 100 : n(deal.marginValue);
    const tutorPerClass = parentPerClass - margin;
    const parentMonthly = classes * parentPerClass;
    const tutorMonthly = classes * tutorPerClass;
    return {
      model: "margin", classes, minutes, hours,
      parentPerClass: r(parentPerClass), parentPerHour: minutes ? r(parentPerClass * 60 / minutes) : 0,
      margin: r(margin), tutorPerClass: r(tutorPerClass), tutorPerHour: minutes ? r(tutorPerClass * 60 / minutes) : 0,
      parentMonthly: r(parentMonthly), tutorMonthly: r(tutorMonthly), agencyMonthly: r(classes * margin),
      parentInstallment: r(parentMonthly / pK), tutorInstallment: r(tutorMonthly / tK),
    };
  }

  const fee = n(deal.monthlyFee);
  const cut = deal.cutType === "percent" ? fee * n(deal.cutValue) / 100 : n(deal.cutValue);
  return {
    model: "commission", classes, minutes, hours,
    monthlyFee: r(fee), perClass: classes ? r(fee / classes) : 0, perHour: hours ? r(fee / hours) : 0,
    cut: r(cut), cutPercent: fee ? Math.round(cut / fee * 1000) / 10 : 0,
    feeTo: deal.feeTo === "Agency" ? "Agency" : "Tutor",
    tutorFirstMonth: r(fee - cut),
    parentInstallment: r(fee / pK), cutInstallment: r(cut / tK), tutorInstallment: r((fee - cut) / tK),
  };
}
