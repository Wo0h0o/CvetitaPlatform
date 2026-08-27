"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Plus, X, Printer, Save, Loader2, Building2, FileText } from "lucide-react";
import { Card } from "@/components/shared/Card";
import {
  labelDoc,
  compositionText,
  netWeightsAll,
  nrvPct,
  marketDate,
  bgDate,
  typeLabel,
  PRODUCER,
  FILING_CONTACT,
  type NzProduct,
  type NzIngredient,
  type NzCompany,
} from "@/lib/notify-docs";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const COMMON_PACKS = [10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 180, 200, 300, 365];
const todayISO = () => new Date().toISOString().slice(0, 10);

interface Refs {
  ingredients: (NzIngredient & { id: number })[];
  companies: (NzCompany & { id: number; is_default?: boolean })[];
  sites: { id: number; name: string; address: string; is_default?: boolean }[];
  options: { id: number; kind: string; value: string }[];
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium uppercase tracking-wider text-text-3 mb-1">{children}</label>;
}
const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-surface text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";

function NotifyProductInner() {
  const params = useSearchParams();
  const router = useRouter();
  const editId = params.get("id");
  const { data: refs } = useSWR<Refs>("/api/notify/refs", fetcher, { revalidateOnFocus: false });

  // ---- product fields ----
  const [name, setName] = useState("");
  const [productType, setProductType] = useState<"supplement" | "sport">("supplement");
  const [audience, setAudience] = useState("за възрастни");
  const [action, setAction] = useState("");
  const [doseForm, setDoseForm] = useState("таблетки");
  const [dailyDose, setDailyDose] = useState("");
  const [doseBasis, setDoseBasis] = useState("");
  const [unitNet, setUnitNet] = useState<string>("");
  const [packSizes, setPackSizes] = useState<number[]>([]);
  const [customPack, setCustomPack] = useState("");
  const [active, setActive] = useState<NzIngredient[]>([]);
  const [additional, setAdditional] = useState<string[]>([]);
  const [addExtra, setAddExtra] = useState("");
  const [sweetener, setSweetener] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [regDate, setRegDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  // ---- заявление context (per submission) ----
  const [mode, setMode] = useState<"cvetita" | "ishleme">("cvetita");
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [submitDate, setSubmitDate] = useState(todayISO());
  const [eikInput, setEikInput] = useState("");
  const [looking, setLooking] = useState(false);
  const [company, setCompany] = useState<NzCompany | null>(null);

  const [ingPick, setIngPick] = useState("");
  const [printOnly, setPrintOnly] = useState<null | "label" | "list" | "app">(null);

  // load existing product
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/notify/products?id=${editId}`)
      .then((r) => r.json())
      .then(({ product: p }) => {
        if (!p) return;
        setName(p.name || "");
        setProductType(p.product_type || "supplement");
        setAudience(p.audience || "за възрастни");
        setAction(p.action || "");
        setDoseForm(p.dose_form || "таблетки");
        setDailyDose(p.daily_dose || "");
        setDoseBasis(p.dose_basis || "");
        setUnitNet(p.unit_net_weight != null ? String(p.unit_net_weight) : "");
        setPackSizes(p.pack_sizes || []);
        setActive(p.active_ingredients || []);
        setAdditional(p.additional_ingredients || []);
        setSweetener(p.sweetener || "");
        setRegNumber(p.reg_number || "");
        setRegDate(p.reg_date || "");
        setSavedId(p.id);
      });
  }, [editId]);

  // default company = Цветита when refs load and mode=cvetita
  useEffect(() => {
    if (!refs) return;
    if (mode === "cvetita") {
      const c = refs.companies.find((x) => x.reg_role === "producer") || refs.companies[0];
      if (c) {
        setCompany(c);
        setCompanyId(c.id);
      }
      const site = refs.sites.find((s) => s.is_default) || refs.sites[0];
      if (site) setSiteId(site.id);
    }
  }, [refs, mode]);

  const options = refs?.options ?? [];
  const doseOpts = options.filter((o) => o.kind === "dose").map((o) => o.value);
  const actionOpts = options.filter((o) => o.kind === "action").map((o) => o.value);

  const product: NzProduct = useMemo(
    () => ({
      name,
      product_type: productType,
      audience,
      action,
      dose_form: doseForm,
      daily_dose: dailyDose,
      dose_basis: doseBasis,
      unit_net_weight: unitNet,
      pack_sizes: packSizes,
      active_ingredients: active,
      additional_ingredients: additional,
      sweetener,
      reg_number: regNumber,
      reg_date: regDate,
    }),
    [name, productType, audience, action, doseForm, dailyDose, doseBasis, unitNet, packSizes, active, additional, sweetener, regNumber, regDate]
  );

  function addIngredient() {
    if (!ingPick || !refs) return;
    const found = refs.ingredients.find((i) => String(i.id) === ingPick);
    if (found) {
      setActive((a) => [...a, { name_bg: found.name_bg, name_lat: found.name_lat, kind: found.kind, unit: found.unit, ref_value: found.ref_value ?? null, amount: "" }]);
    }
    setIngPick("");
  }
  function updateActive(idx: number, patch: Partial<NzIngredient>) {
    setActive((a) => a.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function lookupCompany() {
    if (!eikInput.trim()) return;
    setLooking(true);
    try {
      const r = await fetch(`/api/notify/company-lookup?eik=${eikInput.replace(/\D/g, "")}`).then((x) => x.json());
      if (r.company) {
        setCompany(r.company);
        setCompanyId(r.company.id ?? null);
      }
    } finally {
      setLooking(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        product_type: productType,
        audience,
        action,
        dose_form: doseForm,
        daily_dose: dailyDose,
        dose_basis: doseBasis,
        unit_net_weight: unitNet ? Number(String(unitNet).replace(",", ".")) : null,
        pack_sizes: packSizes,
        active_ingredients: active,
        additional_ingredients: additional,
        sweetener,
        reg_number: regNumber,
        reg_date: regDate || null,
      };
      let res;
      if (savedId) {
        res = await fetch("/api/notify/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: savedId, ...payload }) });
      } else {
        res = await fetch("/api/notify/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      const { product: saved } = await res.json();
      if (saved?.id) {
        setSavedId(saved.id);
        if (!editId) router.replace(`/notify/product?id=${saved.id}`);
      }
      // learn dose/action options
      if (dailyDose && !doseOpts.includes(dailyDose)) fetch("/api/notify/refs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "option", kind: "dose", value: dailyDose }) });
      if (action && !actionOpts.includes(action)) fetch("/api/notify/refs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "option", kind: "action", value: action }) });
    } finally {
      setSaving(false);
    }
  }

  function printDoc(which: "label" | "list" | "app") {
    setPrintOnly(which);
    setTimeout(() => {
      window.print();
      setPrintOnly(null);
    }, 60);
  }

  const isTrader = mode === "ishleme";
  const distributionSite = refs?.sites.find((s) => s.id === siteId);
  const distributionAddr = isTrader
    ? distributionSite?.address || ""
    : PRODUCER.siteAddress;

  return (
    <div>
      <div className="no-print">
        <div className="flex items-center gap-3 mb-5">
          <Link href="/notify" className="text-text-3 hover:text-text"><ArrowLeft size={20} /></Link>
          <h1 className="text-[20px] font-bold text-text">{savedId ? "Продукт" : "Нов продукт"}</h1>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={save} disabled={saving || !name} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-50 cursor-pointer">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Запази
            </button>
          </div>
        </div>

        {/* ===== Режим (шаблон) ===== */}
        <Card className="p-4 mb-4">
          <Label>Шаблон на заявлението</Label>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setMode("cvetita")} className={`px-4 py-2 rounded-lg text-[13px] border ${mode === "cvetita" ? "bg-accent text-white border-accent" : "border-border text-text-2"}`}>
              Цветита (производител)
            </button>
            <button onClick={() => setMode("ishleme")} className={`px-4 py-2 rounded-lg text-[13px] border ${mode === "ishleme" ? "bg-accent text-white border-accent" : "border-border text-text-2"}`}>
              Ишлеме (за друга фирма)
            </button>
          </div>

          {mode === "cvetita" ? (
            <div className="mt-3 text-[12px] text-text-2 bg-surface-2 rounded-lg p-3">
              Заявител: <b>{PRODUCER.name}</b>, {PRODUCER.seat} · Отметка <b>Производител</b>. Тези данни са фиксирани и не се въвеждат наново.
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              <div className="flex gap-2 items-end flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <Label>ЕИК на фирмата</Label>
                  <input value={eikInput} onChange={(e) => setEikInput(e.target.value)} placeholder="напр. 207824602" className={inputCls} />
                </div>
                <button onClick={lookupCompany} disabled={looking} className="flex items-center gap-2 text-[13px] px-3 py-2 rounded-lg border border-border hover:bg-surface-2 cursor-pointer">
                  {looking ? <Loader2 size={15} className="animate-spin" /> : <Building2 size={15} />} Извади данни
                </button>
                {refs && refs.companies.filter((c) => c.reg_role !== "producer").length > 0 && (
                  <select className={inputCls + " max-w-[240px]"} value={companyId ?? ""} onChange={(e) => { const c = refs.companies.find((x) => String(x.id) === e.target.value); if (c) { setCompany(c); setCompanyId(c.id); } }}>
                    <option value="">— запазена фирма —</option>
                    {refs.companies.filter((c) => c.reg_role !== "producer").map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              {company && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>Фирма</Label><input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} className={inputCls} /></div>
                  <div><Label>Управител (трите имена)</Label><input value={company.manager || ""} onChange={(e) => setCompany({ ...company, manager: e.target.value })} className={inputCls} /></div>
                  <div className="sm:col-span-2"><Label>Адрес на управление</Label><input value={company.address || ""} onChange={(e) => setCompany({ ...company, address: e.target.value })} className={inputCls} /></div>
                  <div><Label>Интернет страница (търговия от разстояние)</Label><input value={company.remote_website || ""} onChange={(e) => setCompany({ ...company, remote_website: e.target.value })} className={inputCls} placeholder="ако има" /></div>
                  <div><Label>Имейл / телефон (от разстояние)</Label><input value={company.remote_email || company.remote_phone || ""} onChange={(e) => setCompany({ ...company, remote_email: e.target.value })} className={inputCls} placeholder="ако има" /></div>
                </div>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <div>
              <Label>Обект за дистрибуция</Label>
              <select className={inputCls} value={siteId ?? ""} onChange={(e) => setSiteId(Number(e.target.value) || null)}>
                <option value="">— избери склад —</option>
                {refs?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Дата на подаване</Label>
              <input type="date" value={submitDate} onChange={(e) => setSubmitDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label>Дата на пускане (+14 дни)</Label>
              <input readOnly value={marketDate(submitDate)} className={inputCls + " bg-surface-2"} />
            </div>
          </div>
        </Card>

        {/* ===== Основни данни ===== */}
        <Card className="p-4 mb-4 grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Label>Търговско наименование</Label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="напр. D3+K2+Q10" /></div>
          <div>
            <Label>Вид продукт</Label>
            <div className="flex gap-2">
              <button onClick={() => setProductType("supplement")} className={`flex-1 px-3 py-2 rounded-lg text-[12px] border ${productType === "supplement" ? "bg-accent-soft text-accent border-accent" : "border-border text-text-2"}`}>Хранителна добавка</button>
              <button onClick={() => setProductType("sport")} className={`flex-1 px-3 py-2 rounded-lg text-[12px] border ${productType === "sport" ? "bg-accent-soft text-accent border-accent" : "border-border text-text-2"}`}>Интензивно мускулно натоварване</button>
            </div>
          </div>
          <div><Label>Предназначена за</Label><input value={audience} onChange={(e) => setAudience(e.target.value)} className={inputCls} placeholder="за възрастни" /></div>
          <div className="sm:col-span-2">
            <Label>Действие / предназначение</Label>
            <input list="action-opts" value={action} onChange={(e) => setAction(e.target.value)} className={inputCls} placeholder="Участва в поддържането на…" />
            <datalist id="action-opts">{actionOpts.map((o) => <option key={o} value={o} />)}</datalist>
          </div>
          <div>
            <Label>Форма</Label>
            <select value={doseForm} onChange={(e) => setDoseForm(e.target.value)} className={inputCls}>
              {["таблетки", "капсули", "прах", "ml"].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div><Label>Състав е за доза (напр. „2 таблетки“, „5 грама“)</Label><input value={doseBasis} onChange={(e) => setDoseBasis(e.target.value)} className={inputCls} placeholder="2 таблетки" /></div>
          <div className="sm:col-span-2">
            <Label>Препоръчителна дневна доза (текст)</Label>
            <input list="dose-opts" value={dailyDose} onChange={(e) => setDailyDose(e.target.value)} className={inputCls} placeholder="по 1 таблетка на ден с храна" />
            <datalist id="dose-opts">{doseOpts.map((o) => <option key={o} value={o} />)}</datalist>
          </div>
        </Card>

        {/* ===== Разфасовки ===== */}
        <Card className="p-4 mb-4">
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div><Label>Нетно тегло на 1 {doseForm === "прах" ? "грам" : doseForm === "капсули" ? "капсула" : doseForm === "ml" ? "ml" : "таблетка"} (g)</Label><input value={unitNet} onChange={(e) => setUnitNet(e.target.value)} className={inputCls} placeholder="напр. 0,233" /></div>
          </div>
          <Label>Разфасовки (брой в опаковка)</Label>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_PACKS.map((c) => {
              const on = packSizes.includes(c);
              return (
                <button key={c} onClick={() => setPackSizes((p) => (on ? p.filter((x) => x !== c) : [...p, c].sort((a, b) => a - b)))} className={`px-2.5 py-1 rounded-md text-[12px] border ${on ? "bg-accent text-white border-accent" : "border-border text-text-2"}`}>{c}</button>
              );
            })}
            <input value={customPack} onChange={(e) => setCustomPack(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter" && customPack) { setPackSizes((p) => [...new Set([...p, Number(customPack)])].sort((a, b) => a - b)); setCustomPack(""); } }} placeholder="+ друго" className="w-[70px] px-2 py-1 rounded-md border border-border text-[12px] bg-surface" />
          </div>
          {packSizes.length > 0 && unitNet && (
            <div className="mt-2 text-[12px] text-text-3">Нетно количество: {netWeightsAll(product)}</div>
          )}
        </Card>

        {/* ===== Активни съставки ===== */}
        <Card className="p-4 mb-4">
          <div className="flex items-end gap-2 mb-3">
            <div className="flex-1">
              <Label>Активни съставки (дневна доза)</Label>
              <select value={ingPick} onChange={(e) => setIngPick(e.target.value)} className={inputCls}>
                <option value="">— избери съставка —</option>
                {refs?.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name_bg}{i.kind === "herb" && i.name_lat ? ` (${i.name_lat})` : ""}</option>)}
              </select>
            </div>
            <button onClick={addIngredient} disabled={!ingPick} className="flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg bg-accent text-white disabled:opacity-50 cursor-pointer"><Plus size={15} /> Добави</button>
          </div>
          <div className="space-y-2">
            {active.map((ing, idx) => {
              const pct = nrvPct(ing.amount, ing.ref_value ?? null);
              return (
                <div key={idx} className="flex items-center gap-2 flex-wrap bg-surface-2 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-[160px] text-[13px] text-text">
                    {ing.name_bg}{ing.kind === "herb" && ing.name_lat ? <span className="text-text-3 italic"> ({ing.name_lat})</span> : ""}
                  </div>
                  <input value={String(ing.amount)} onChange={(e) => updateActive(idx, { amount: e.target.value })} placeholder="кол-во" className="w-[90px] px-2 py-1 rounded-md border border-border text-[13px] bg-surface" />
                  <span className="text-[12px] text-text-3 w-[40px]">{ing.unit}</span>
                  {ing.ref_value != null && ing.ref_value !== "" ? (
                    <span className="text-[12px] text-accent w-[64px] text-right">{pct !== null ? `${pct}%` : "—"}</span>
                  ) : <span className="w-[64px]" />}
                  <button onClick={() => setActive((a) => a.filter((_, i) => i !== idx))} className="text-text-3 hover:text-red-500"><X size={15} /></button>
                </div>
              );
            })}
            {active.length === 0 && <div className="text-[12px] text-text-3">Няма добавени съставки.</div>}
          </div>
        </Card>

        {/* ===== Допълнителни съставки ===== */}
        <Card className="p-4 mb-4">
          <Label>Допълнителни съставки (пълнители)</Label>
          <div className="flex gap-2 mb-2">
            <input value={addExtra} onChange={(e) => setAddExtra(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && addExtra.trim()) { setAdditional((a) => [...a, addExtra.trim()]); setAddExtra(""); } }} placeholder="напр. Микрокристална целулоза" className={inputCls} />
            <button onClick={() => { if (addExtra.trim()) { setAdditional((a) => [...a, addExtra.trim()]); setAddExtra(""); } }} className="px-3 py-2 rounded-lg bg-accent text-white text-[13px] cursor-pointer">Добави</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {additional.map((x, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-surface-2 rounded-md px-2 py-1 text-[12px]">{x}<button onClick={() => setAdditional((a) => a.filter((_, j) => j !== i))} className="text-text-3 hover:text-red-500"><X size={12} /></button></span>
            ))}
          </div>
          <div className="mt-3"><Label>Подсладител (по избор)</Label><input value={sweetener} onChange={(e) => setSweetener(e.target.value)} className={inputCls} placeholder="напр. Стевия (Stevia Rebaudiana)" /></div>
        </Card>

        {/* ===== Документи ===== */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[13px] font-semibold text-text flex items-center gap-1.5"><FileText size={16} /> Документи:</span>
          <button onClick={() => printDoc("label")} className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 cursor-pointer"><Printer size={14} /> Проекто-етикет</button>
          <button onClick={() => printDoc("list")} className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 cursor-pointer"><Printer size={14} /> Списък</button>
          <button onClick={() => printDoc("app")} className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 cursor-pointer"><Printer size={14} /> Заявление</button>
        </div>
      </div>

      {/* ===== Print area ===== */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #docs, #docs * { visibility: visible !important; }
        #docs { position: absolute; left: 0; top: 0; width: 100%; }
        .doc-page { page-break-after: always; }
      }`}</style>
      <div id="docs" className="space-y-6">
        <DocLabel product={product} hidden={printOnly !== null && printOnly !== "label"} />
        <DocList product={product} company={mode === "cvetita" ? { name: PRODUCER.name } : company} hidden={printOnly !== null && printOnly !== "list"} />
        <DocApplication
          product={product}
          mode={mode}
          company={company}
          isTrader={isTrader}
          distributionAddr={distributionAddr}
          submitDate={submitDate}
          hidden={printOnly !== null && printOnly !== "app"}
        />
      </div>
    </div>
  );
}

// ---------- Document renderers (A4, black on white) ----------
const paper = "doc-page bg-white text-black rounded-xl p-8 md:p-10 max-w-[900px] mx-auto shadow-sm text-[13px] leading-relaxed";

function DocLabel({ product, hidden }: { product: NzProduct; hidden: boolean }) {
  const d = labelDoc(product);
  return (
    <div className={`${paper} ${hidden ? "hidden" : ""}`}>
      <div className="text-center text-[10px] uppercase tracking-wider text-gray-400 mb-3">Проекто-етикет</div>
      <h2 className="text-[20px] font-bold text-center">{d.name || "—"}</h2>
      <p className="text-center text-[13px] mb-3">{d.subtitle}</p>
      <p className="text-gray-600 text-[11px]">{d.regLine}</p>
      {d.action && <p className="mt-2"><b>{d.action}</b></p>}
      <p className="mt-2">{d.packsLine}</p>
      <p>{d.countLine}</p>
      <p>{d.netLine}</p>
      {d.doseLine && <p className="mt-2">{d.doseLine}</p>}
      <p className="mt-2">{d.composition}</p>
      {d.additional && <p className="mt-1">{d.additional}</p>}
      {d.sweetener && <p className="mt-1">{d.sweetener}</p>}
      <p className="mt-1">{d.contents}</p>
      <ul className="mt-3 space-y-0.5 text-[12px]">
        {d.warnings.map((w) => <li key={w}>• {w}</li>)}
      </ul>
      <p className="mt-3 text-[12px]">{d.producer}</p>
      <div className="mt-1 text-[12px] text-gray-600">{d.footer.map((f) => <div key={f}>{f}</div>)}</div>
    </div>
  );
}

function DocList({ product, company, hidden }: { product: NzProduct; company: { name: string } | null; hidden: boolean }) {
  return (
    <div className={`${paper} ${hidden ? "hidden" : ""}`}>
      <div className="text-center text-[11px]">(Образец КХ № 24)</div>
      <p className="text-center text-[11px] text-gray-600 mt-1">Приложение към Заявление за пускане на пазара на хранителна добавка и/или храна, предназначена за употреба при интензивно мускулно натоварване</p>
      <h3 className="text-center font-bold mt-3 text-[13px]">СПИСЪК НА ХРАНИТЕЛНИТЕ ДОБАВКИ ИЛИ ХРАНИ, ПРЕДНАЗНАЧЕНИ ЗА УПОТРЕБА ПРИ ИНТЕНЗИВНО МУСКУЛНО НАТОВАРВАНЕ КЪМ ЗАЯВЛЕНИЕ ОТ</h3>
      <p className="text-center font-semibold mt-1">ФИРМА {(company?.name || PRODUCER.name).toUpperCase()}</p>
      <p className="mt-3"><b>1. Търговско наименование:</b> {product.name || "—"}</p>
      <p className="mt-1"><b>Х</b> {typeLabel(product.product_type)}, която се произвежда в обект, находящ се в: {PRODUCER.siteAddress}</p>
      <p className="mt-1 text-[11px] text-gray-600">(точен адрес на обекта, в който ще се осъществява дейността)</p>
      <p className="mt-1">От {PRODUCER.name}, {PRODUCER.seat}</p>
      <p className="mt-1 text-[11px] text-gray-600">(наименование, седалище и адрес на управление на бизнес оператора по производство)</p>
      <p className="mt-2">с качествен и количествен състав на веществата с хранителен и физиологичен ефект в препоръчаната дневна доза:</p>
      <p className="mt-1">Дози в опаковка: {(product.pack_sizes ?? []).join(", ")}</p>
      <p>Нетно количество: {netWeightsAll(product)}</p>
      <p className="mt-1">{compositionText(product)}</p>
      {product.daily_dose && <p className="mt-1">Препоръчителна дневна доза: {product.daily_dose}</p>}
      {product.sweetener && <p className="mt-1">Подсладител: {product.sweetener}</p>}
      {product.action && <p className="mt-1">и е предназначена за: {product.action}</p>}
      <p className="mt-2">и законно се предлагат на пазара на друга държава членка на ЕС: <b>Х не</b></p>
    </div>
  );
}

function DocApplication({
  product, mode, company, isTrader, distributionAddr, submitDate, hidden,
}: {
  product: NzProduct; mode: "cvetita" | "ishleme"; company: NzCompany | null; isTrader: boolean; distributionAddr: string; submitDate: string; hidden: boolean;
}) {
  const reg = mode === "cvetita"
    ? { manager: "Георги Добрев Петков", name: PRODUCER.name, address: `гр. Бургас, община Бургас, ул. Граф Игнатиев № 17`, eik: "203492157" }
    : { manager: company?.manager || "……………", name: company?.name || "……………", address: company?.address || "……………", eik: company?.eik || "……………" };
  const remote = isTrader && (company?.remote_website || company?.remote_email || company?.remote_phone);
  return (
    <div className={`${paper} ${hidden ? "hidden" : ""}`}>
      <div className="text-[10px] text-gray-500">Приложение № 24 към Заповед № РД 11-1696/24.07.2020 г. (Образец KХ № 24)</div>
      <div className="text-center mt-3 text-[12px]">ДО ИЗПЪЛНИТЕЛНИЯ ДИРЕКТОР НА<br />БЪЛГАРСКАТА АГЕНЦИЯ ПО БЕЗОПАСНОСТ НА ХРАНИТЕ, ГР. СОФИЯ</div>
      <h3 className="text-center font-bold mt-3">З А Я В Л Е Н И Е</h3>
      <p className="text-center text-[12px]">ЗА ПУСКАНЕ НА ПАЗАРА НА ХРАНИТЕЛНА ДОБАВКА И/ИЛИ ХРАНА, ПРЕДНАЗНАЧЕНА ЗА УПОТРЕБА ПРИ ИНТЕНЗИВНО МУСКУЛНО НАТОВАРВАНЕ</p>
      <p className="mt-3">От <b>{reg.manager}</b>, в качеството му на <b>управител</b> на фирма <b>{reg.name}</b>, адрес на управление: {reg.address}, ЕИК/БУЛСТАТ {reg.eik}, Телефон: {FILING_CONTACT.phone}, e-mail: {FILING_CONTACT.email}</p>
      <p className="mt-2">{mode === "cvetita" ? "Производител в Република България:  Х" : "Търговец:  Х"}</p>
      <p className="mt-2">Моля да бъдат регистрирани по чл. 79 от Закона за храните:</p>
      <p>{product.product_type === "supplement" ? "Х  хранителни добавки — 1 бр." : "Х  храни, предназначени за употреба при интензивно мускулно натоварване — 1 бр."}</p>
      <p className="mt-2">Вид и адрес на обекта за дистрибуция: {distributionAddr || "……………"}</p>
      <p className="mt-2">Търговия с храни от разстояние: <b>{remote ? "Х да" : "Х не"}</b></p>
      {remote && (
        <p className="text-[12px]">Описание: чрез поръчки в интернет страница, по телефон или имейл. {company?.remote_website ? `Интернет страница: ${company.remote_website}. ` : ""}{company?.remote_email ? `Имейл: ${company.remote_email}. ` : ""}{company?.remote_phone ? `Телефон: ${company.remote_phone}.` : ""}</p>
      )}
      <p className="mt-2">Продуктът ще бъде пуснат на пазара на територията на Република България на: <b>{marketDate(submitDate)}</b> <span className="text-[11px] text-gray-500">(не по-рано от 14 дни от подаване)</span></p>
      <div className="mt-6 flex justify-between text-[12px]">
        <div>гр. {mode === "cvetita" ? "Бургас" : "………"}<br />Дата: {bgDate(submitDate)}</div>
        <div>ЗАЯВИТЕЛ: ………………………<br />/подпис/</div>
      </div>
    </div>
  );
}

export default function NotifyProductPage() {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>}>
      <NotifyProductInner />
    </Suspense>
  );
}
