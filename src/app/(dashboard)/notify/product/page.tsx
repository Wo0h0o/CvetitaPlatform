"use client";

import { useEffect, useMemo, useState, Suspense, type CSSProperties, type ReactNode } from "react";
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
  PRODUCER,
  FILING_CONTACT,
  CVETITA_REMOTE,
  type NzProduct,
  type NzIngredient,
  type NzCompany,
} from "@/lib/notify-docs";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const COMMON_PACKS = [10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 180, 200, 300, 365];
const todayISO = () => new Date().toISOString().slice(0, 10);
const DEFAULT_REMOTE_DESC = "чрез постъпили поръчки в интернет страница, по телефон или по имейл адрес.";

interface RemoteTrade {
  on: boolean;
  desc: string;
  website: string;
  phone: string;
  email: string;
}

interface Refs {
  ingredients: (NzIngredient & { id: number })[];
  companies: (NzCompany & { id: number; is_default?: boolean })[];
  sites: { id: number; name: string; address: string; is_default?: boolean }[];
  options: { id: number; kind: string; value: string }[];
}

function Label({ children }: { children: ReactNode }) {
  return <label className="block text-[11px] font-medium uppercase tracking-wider text-text-3 mb-1">{children}</label>;
}
const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-surface text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";

function NotifyProductInner() {
  const params = useSearchParams();
  const router = useRouter();
  const editId = params.get("id");
  const { data: refs, mutate: mutateRefs } = useSWR<Refs>("/api/notify/refs", fetcher, { revalidateOnFocus: false });

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
  const [distAddr, setDistAddr] = useState("");
  const [submitDate, setSubmitDate] = useState(todayISO());
  const [looking, setLooking] = useState(false);
  const [lookupNote, setLookupNote] = useState("");
  const [company, setCompany] = useState<NzCompany | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);
  const [remote, setRemote] = useState<RemoteTrade>({ on: true, desc: DEFAULT_REMOTE_DESC, website: CVETITA_REMOTE.website, phone: CVETITA_REMOTE.phone, email: CVETITA_REMOTE.email });

  const [ingPick, setIngPick] = useState("");
  const [printOnly, setPrintOnly] = useState<null | "label" | "list" | "app">(null);

  // нова съставка (не е в списъка)
  const [showNewIng, setShowNewIng] = useState(false);
  const emptyNewIng = { name_bg: "", kind: "other" as NzIngredient["kind"], unit: "mg", name_lat: "", ref_value: "" };
  const [newIng, setNewIng] = useState(emptyNewIng);

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

  // адрес на дистрибуция: Цветита = фиксиран производствен адрес; ишлеме = избран склад или свободен текст
  useEffect(() => {
    if (mode === "cvetita") setDistAddr(PRODUCER.siteAddress);
    else setDistAddr("");
  }, [mode]);

  // при Ишлеме показвай веднага празни фирмени полета (без да чакаш lookup)
  useEffect(() => {
    if (mode === "ishleme") {
      setCompany((c) => (c && c.reg_role !== "producer" ? c : { eik: "", name: "", manager: "", address: "" }));
      setCompanyId(null);
    }
  }, [mode]);

  // prefill remote-trade block when mode or company identity changes
  useEffect(() => {
    if (mode === "cvetita") {
      setRemote({ on: true, desc: DEFAULT_REMOTE_DESC, website: CVETITA_REMOTE.website, phone: CVETITA_REMOTE.phone, email: CVETITA_REMOTE.email });
    } else {
      const w = company?.remote_website || "";
      const p = company?.remote_phone || "";
      const e = company?.remote_email || "";
      setRemote({ on: !!(w || p || e), desc: DEFAULT_REMOTE_DESC, website: w, phone: p, email: e });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, company?.eik]);

  async function saveCompany() {
    if (!company?.eik || !company?.name) { setLookupNote("Попълни поне ЕИК и име на фирмата."); return; }
    setSavingCompany(true);
    try {
      const res = await fetch("/api/notify/refs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "company",
          eik: company.eik,
          name: company.name,
          manager: company.manager || "",
          address: company.address || "",
          reg_role: "trader",
          remote_website: remote.on ? remote.website : "",
          remote_phone: remote.on ? remote.phone : "",
          remote_email: remote.on ? remote.email : "",
        }),
      });
      const j = await res.json();
      if (j.item?.id) { setCompany(j.item); setCompanyId(j.item.id); }
      setLookupNote("Фирмата е запазена.");
      mutateRefs();
    } finally {
      setSavingCompany(false);
    }
  }

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
  async function addCustomIngredient() {
    if (!newIng.name_bg.trim()) return;
    const ing: NzIngredient = {
      name_bg: newIng.name_bg.trim(),
      name_lat: newIng.kind === "herb" ? newIng.name_lat.trim() || null : null,
      kind: newIng.kind,
      unit: newIng.unit.trim() || "mg",
      ref_value: newIng.kind === "vitmin" && newIng.ref_value ? newIng.ref_value : null,
      amount: "",
    };
    setActive((a) => [...a, ing]);
    // запази в базата за следващ път
    await fetch("/api/notify/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ingredient", name_bg: ing.name_bg, name_lat: ing.name_lat, kind: ing.kind, unit: ing.unit, ref_value: ing.ref_value }),
    }).catch(() => {});
    mutateRefs();
    setNewIng(emptyNewIng);
    setShowNewIng(false);
  }

  async function lookupCompany() {
    const eik = (company?.eik || "").replace(/\D/g, "");
    if (!eik) { setLookupNote("Въведи ЕИК."); return; }
    setLooking(true);
    setLookupNote("");
    try {
      const res = await fetch(`/api/notify/company-lookup?eik=${eik}`);
      if (!res.ok) { setLookupNote(`Грешка ${res.status}. Опитай пак след минута.`); return; }
      const r = await res.json();
      if (r.company && r.company.name) {
        setCompany((c) => ({ eik, name: "", manager: "", address: "", ...c, ...r.company }));
        setCompanyId(r.company.id ?? null);
        const src = r.source === "saved" ? "запазена фирма" : r.source === "papagal" ? "Търговския регистър" : "VIES";
        setLookupNote(`Извадено от ${src} — провери данните и натисни „Запази фирмата“.`);
      } else {
        setLookupNote(r.note || "Не намерих фирмата автоматично — попълни ръчно.");
      }
    } catch {
      setLookupNote("Няма връзка. Опитай пак.");
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
              {refs && refs.companies.filter((c) => c.reg_role !== "producer").length > 0 && (
                <div>
                  <Label>Избери запазена фирма</Label>
                  <select className={inputCls} value={companyId ?? ""} onChange={(e) => { const c = refs.companies.find((x) => String(x.id) === e.target.value); if (c) { setCompany(c); setCompanyId(c.id); } else { setCompany({ eik: "", name: "", manager: "", address: "" }); setCompanyId(null); } }}>
                    <option value="">— нова фирма —</option>
                    {refs.companies.filter((c) => c.reg_role !== "producer").map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {company && (
                <>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label>ЕИК / БУЛСТАТ</Label>
                      <div className="flex gap-2">
                        <input value={company.eik || ""} onChange={(e) => setCompany({ ...company, eik: e.target.value })} placeholder="напр. 201117033" className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") lookupCompany(); }} />
                        <button onClick={lookupCompany} disabled={looking} title="Извади име, адрес и управител от Търговския регистър по ЕИК" className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer whitespace-nowrap disabled:opacity-50">
                          {looking ? <Loader2 size={15} className="animate-spin" /> : <Building2 size={15} />} Извади данни
                        </button>
                      </div>
                    </div>
                    <div><Label>Фирма</Label><input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} className={inputCls} placeholder="напр. КОККОЛИС ЕООД" /></div>
                    <div><Label>Управител (трите имена)</Label><input value={company.manager || ""} onChange={(e) => setCompany({ ...company, manager: e.target.value })} className={inputCls} /></div>
                    <div><Label>Адрес на управление</Label><input value={company.address || ""} onChange={(e) => setCompany({ ...company, address: e.target.value })} className={inputCls} placeholder="гр. …, ул. … № …" /></div>
                  </div>
                  {lookupNote && <div className="text-[12px] text-text-2 bg-surface-2 rounded-lg px-3 py-2">{lookupNote}</div>}

                  {/* Търговия от разстояние — редактируемо за ишлеме */}
                  <div className="rounded-lg border border-border p-3 mt-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Label>Търговия с храни от разстояние</Label>
                      <div className="flex gap-1.5 -mt-1">
                        <button onClick={() => setRemote((r) => ({ ...r, on: true }))} className={`px-3 py-1 rounded-md text-[12px] border ${remote.on ? "bg-accent text-white border-accent" : "border-border text-text-2"}`}>да</button>
                        <button onClick={() => setRemote((r) => ({ ...r, on: false }))} className={`px-3 py-1 rounded-md text-[12px] border ${!remote.on ? "bg-accent text-white border-accent" : "border-border text-text-2"}`}>не</button>
                      </div>
                    </div>
                    {remote.on && (
                      <div className="grid gap-2">
                        <div><Label>Описание</Label><input value={remote.desc} onChange={(e) => setRemote((r) => ({ ...r, desc: e.target.value }))} className={inputCls} /></div>
                        <div className="grid sm:grid-cols-3 gap-2">
                          <div><Label>Интернет страница</Label><input value={remote.website} onChange={(e) => setRemote((r) => ({ ...r, website: e.target.value }))} className={inputCls} placeholder="www…" /></div>
                          <div><Label>Телефонен номер</Label><input value={remote.phone} onChange={(e) => setRemote((r) => ({ ...r, phone: e.target.value }))} className={inputCls} /></div>
                          <div><Label>Електронна поща</Label><input value={remote.email} onChange={(e) => setRemote((r) => ({ ...r, email: e.target.value }))} className={inputCls} /></div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button onClick={saveCompany} disabled={savingCompany} className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-lg border border-border hover:bg-surface-2 cursor-pointer disabled:opacity-50">
                      {savingCompany ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />} Запази фирмата
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <div>
              <Label>Дата на подаване</Label>
              <input type="date" value={submitDate} onChange={(e) => setSubmitDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label>Дата на пускане (+14 дни)</Label>
              <input readOnly value={marketDate(submitDate)} className={inputCls + " bg-surface-2"} />
            </div>
          </div>

          <div className="mt-3">
            <Label>Обект за дистрибуция</Label>
            <select
              className={inputCls + " mb-2"}
              value={siteId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value) || null;
                setSiteId(id);
                const s = refs?.sites.find((x) => x.id === id);
                if (s) setDistAddr(s.address);
              }}
            >
              <option value="">— избери склад (или пиши свободно долу) —</option>
              {refs?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <textarea
              value={distAddr}
              onChange={(e) => setDistAddr(e.target.value)}
              rows={2}
              className={inputCls + " resize-y"}
              placeholder="Вид и адрес на обекта за дистрибуция — избери от списъка или напиши ръчно"
            />
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
            <button onClick={() => setShowNewIng((v) => !v)} className="text-[12px] px-3 py-2 rounded-lg border border-border text-text-2 hover:bg-surface-2 cursor-pointer whitespace-nowrap">+ нова</button>
          </div>

          {showNewIng && (
            <div className="mb-3 p-3 rounded-lg border border-dashed border-border bg-surface-2 grid sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
              <div>
                <Label>Име (българско)</Label>
                <input value={newIng.name_bg} onChange={(e) => setNewIng({ ...newIng, name_bg: e.target.value })} className={inputCls} placeholder="напр. Витамин K2-MK7" />
              </div>
              <div>
                <Label>Вид</Label>
                <select value={newIng.kind} onChange={(e) => setNewIng({ ...newIng, kind: e.target.value as NzIngredient["kind"] })} className={inputCls}>
                  <option value="other">друга</option>
                  <option value="herb">билка</option>
                  <option value="vitmin">витамин/минерал</option>
                </select>
              </div>
              <div className="w-[80px]">
                <Label>Мярка</Label>
                <input value={newIng.unit} onChange={(e) => setNewIng({ ...newIng, unit: e.target.value })} className={inputCls} placeholder="mg" />
              </div>
              <button onClick={addCustomIngredient} disabled={!newIng.name_bg.trim()} className="px-3 py-2 rounded-lg bg-accent text-white text-[13px] disabled:opacity-50 cursor-pointer">Запази</button>
              {newIng.kind === "herb" && (
                <div className="sm:col-span-4">
                  <Label>Латинско име</Label>
                  <input value={newIng.name_lat} onChange={(e) => setNewIng({ ...newIng, name_lat: e.target.value })} className={inputCls} placeholder="напр. Menaquinone-7" />
                </div>
              )}
              {newIng.kind === "vitmin" && (
                <div className="sm:col-span-4">
                  <Label>Референтна стойност (за % NRV — по избор)</Label>
                  <input value={newIng.ref_value} onChange={(e) => setNewIng({ ...newIng, ref_value: e.target.value })} className={inputCls} placeholder="напр. 75" />
                </div>
              )}
            </div>
          )}
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
        <DocList product={product} companyName={mode === "cvetita" ? PRODUCER.name : company?.name || PRODUCER.name} hidden={printOnly !== null && printOnly !== "list"} />
        <DocApplication
          product={product}
          mode={mode}
          company={company}
          distributionAddr={distAddr}
          remote={remote}
          submitDate={submitDate}
          hidden={printOnly !== null && printOnly !== "app"}
        />
      </div>
    </div>
  );
}

// ---------- Document renderers (A4, serif, 1:1 с образеца) ----------
const paperCls = "doc-page bg-white rounded-xl mx-auto shadow-sm";
const paperStyle: CSSProperties = {
  fontFamily: '"Times New Roman", Georgia, serif',
  color: "#000",
  fontSize: 15,
  lineHeight: 1.5,
  padding: "16mm 15mm",
  maxWidth: 820,
  textAlign: "justify",
};

/** Кутийка за отметка (☐ / ☒). */
function Box({ on }: { on?: boolean }) {
  return (
    <span style={{ display: "inline-flex", width: 15, height: 15, border: "1px solid #000", alignItems: "center", justifyContent: "center", fontSize: 11, lineHeight: "13px", verticalAlign: "middle", margin: "0 3px" }}>
      {on ? "Х" : ""}
    </span>
  );
}

/** Дата в отделни клетки: 1 0 0 9 2 0 2 6 г */
function DateCells({ date }: { date: string }) {
  const ds = date.replace(/\D/g, "").slice(0, 8).split("");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", margin: "6px 0" }}>
      {ds.map((d, i) => (
        <span key={i} style={{ width: 24, height: 28, borderTop: "1px solid #000", borderBottom: "1px solid #000", borderRight: "1px solid #000", borderLeft: i === 0 ? "1px solid #000" : "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{d}</span>
      ))}
      <span style={{ marginLeft: 6 }}>г</span>
    </span>
  );
}

function DocLabel({ product, hidden }: { product: NzProduct; hidden: boolean }) {
  const d = labelDoc(product);
  return (
    <div className={`${paperCls} ${hidden ? "hidden" : ""}`} style={paperStyle}>
      <div style={{ textAlign: "center", fontSize: 10, letterSpacing: 1, color: "#999", marginBottom: 8 }}>ПРОЕКТО-ЕТИКЕТ</div>
      <h2 style={{ textAlign: "center", fontSize: 22, fontWeight: 700 }}>{d.name || "—"}</h2>
      <p style={{ textAlign: "center", marginBottom: 8 }}>{d.subtitle}</p>
      <p style={{ fontSize: 12, color: "#555" }}>{d.regLine}</p>
      {d.action && <p style={{ marginTop: 6, fontWeight: 700 }}>{d.action}</p>}
      <p style={{ marginTop: 6 }}>{d.packsLine}</p>
      <p>{d.countLine}</p>
      <p>{d.netLine}</p>
      {d.doseLine && <p style={{ marginTop: 6 }}>{d.doseLine}</p>}
      <p style={{ marginTop: 6 }}>{d.composition}</p>
      {d.additional && <p style={{ marginTop: 3 }}>{d.additional}</p>}
      {d.sweetener && <p style={{ marginTop: 3 }}>{d.sweetener}</p>}
      <p style={{ marginTop: 3 }}>{d.contents}</p>
      <div style={{ marginTop: 10 }}>{d.warnings.map((w) => <div key={w}>{w}</div>)}</div>
      <p style={{ marginTop: 12 }}>{d.producer}</p>
      <div style={{ marginTop: 4, color: "#555" }}>{d.footer.map((f) => <div key={f}>{f}</div>)}</div>
    </div>
  );
}

function DocList({ product, companyName, hidden }: { product: NzProduct; companyName: string; hidden: boolean }) {
  const sport = product.product_type === "sport";
  return (
    <div className={`${paperCls} ${hidden ? "hidden" : ""}`} style={paperStyle}>
      <div style={{ textAlign: "center" }}>(Образец КХ № 24)</div>
      <p style={{ textAlign: "center", fontSize: 12, color: "#555", marginTop: 4 }}>Приложение към Заявление за пускане на пазара на хранителна добавка и/или храна, предназначена за употреба при интензивно мускулно натоварване</p>
      <h3 style={{ textAlign: "center", fontWeight: 700, marginTop: 12 }}>СПИСЪК НА ХРАНИТЕЛНИТЕ ДОБАВКИ ИЛИ ХРАНИ, ПРЕДНАЗНАЧЕНИ ЗА УПОТРЕБА ПРИ ИНТЕНЗИВНО МУСКУЛНО НАТОВАРВАНЕ КЪМ ЗАЯВЛЕНИЕ ОТ</h3>
      <p style={{ textAlign: "center", fontWeight: 600, marginTop: 4 }}>ФИРМА {companyName.toUpperCase()}</p>
      <p style={{ marginTop: 12 }}><b>1. Търговско наименование:</b> {product.name || "—"}</p>
      <p style={{ marginTop: 4 }}>
        <Box on={!sport} /> хранителна добавка, <Box on={sport} /> храна, предназначена за употреба при интензивно мускулно натоварване, която се произвежда в обект, находящ се в: {PRODUCER.siteAddress}
      </p>
      <p style={{ fontSize: 12, color: "#555" }}>(точен адрес на обекта, в който ще се осъществява дейността)</p>
      <p style={{ marginTop: 4 }}>От {PRODUCER.name}, {PRODUCER.seat}</p>
      <p style={{ fontSize: 12, color: "#555" }}>(наименование, седалище и адрес на управление на бизнес оператора по производство)</p>
      <p style={{ marginTop: 8 }}>с качествен и количествен състав на веществата с хранителен и физиологичен ефект в препоръчаната дневна доза:</p>
      <p style={{ marginTop: 4 }}>Дози в опаковка: {(product.pack_sizes ?? []).join(", ")}</p>
      <p>Нетно количество: {netWeightsAll(product)}</p>
      <p style={{ marginTop: 4 }}>{compositionText(product)}</p>
      {product.daily_dose && <p style={{ marginTop: 4 }}>Препоръчителна дневна доза: {product.daily_dose}</p>}
      {product.sweetener && <p style={{ marginTop: 4 }}>Подсладител: {product.sweetener}</p>}
      {product.action && <p style={{ marginTop: 4 }}>и е предназначена за: {product.action}</p>}
      <p style={{ fontSize: 12, color: "#555" }}>(описание на предназначението на хранителната добавка или храната)</p>
      <p style={{ marginTop: 6 }}>и законно се предлагат на пазара на друга държава членка на ЕС <Box on /> не, <Box /> да</p>
    </div>
  );
}

function DocApplication({
  product, mode, company, distributionAddr, remote, submitDate, hidden,
}: {
  product: NzProduct; mode: "cvetita" | "ishleme"; company: NzCompany | null; distributionAddr: string; remote: RemoteTrade; submitDate: string; hidden: boolean;
}) {
  const isTrader = mode === "ishleme";
  const reg = mode === "cvetita"
    ? { manager: "ГЕОРГИ ДОБРЕВ ПЕТКОВ", name: "ЦВЕТИТА ХЕРБАЛ ЕООД", address: "гр. Бургас, община Бургас, ж.к./ул ГРАФ ИГНАТИЕВ № 17", eik: "203492157", city: "Бургас" }
    : {
        manager: company?.manager || "……………………………",
        name: company?.name || "……………………………",
        address: company?.address || "……………………………",
        eik: company?.eik || "…………………",
        city: (company?.address || "").match(/гр\.?\s*([А-Яа-яЁё\-]+)/)?.[1] || "………",
      };
  const supplement = product.product_type === "supplement";

  return (
    <div className={`${paperCls} ${hidden ? "hidden" : ""}`} style={paperStyle}>
      <div style={{ fontSize: 11 }}>
        Приложение № 24 към Заповед № РД 11-1696/24.07.2020 г. на изп. директор на БАБХ <b>(Образец KХ № 24)</b><br />
        <span style={{ fontSize: 10, color: "#444" }}>Изменен със Заповед № РД 11-1206/10.06.2021 г., Заповед № РД 11-1477/29.06.2021 г. и Заповед № РД 11-43/14.01.2022 г. на изпълнителния директор на БАБХ</span>
      </div>
      <div style={{ marginTop: 22, fontWeight: 700 }}>ДО<br />ИЗПЪЛНИТЕЛНИЯ ДИРЕКТОР НА<br />БЪЛГАРСКАТА АГЕНЦИЯ ПО БЕЗОПАСНОСТ НА ХРАНИТЕ ГР. СОФИЯ</div>

      <h3 style={{ textAlign: "center", fontWeight: 700, letterSpacing: 4, marginTop: 26 }}>З А Я В Л Е Н И Е</h3>
      <p style={{ textAlign: "center" }}>ЗА ПУСКАНЕ НА ПАЗАРА НА ХРАНИТЕЛНА ДОБАВКА И/ИЛИ<br />ХРАНА, ПРЕДНАЗНАЧЕНА ЗА УПОТРЕБА ПРИ ИНТЕНЗИВНО МУСКУЛНО НАТОВАРВАНЕ</p>

      <p style={{ textAlign: "center", marginTop: 18 }}>От {reg.manager}</p>
      <p style={{ textAlign: "center", fontSize: 12, color: "#555" }}>(трите имена)</p>
      <p style={{ marginTop: 6 }}>В качеството му на  УПРАВИТЕЛ</p>
      <p style={{ fontSize: 12, color: "#555" }}>(управител, упълномощено лице)</p>
      <p style={{ marginTop: 4 }}>на фирма {reg.name} адрес на управление: {reg.address} тел {FILING_CONTACT.phone} ЕИК/БУЛСТАТ {reg.eik}</p>
      <p>Телефон: {FILING_CONTACT.phone} e-mail: {FILING_CONTACT.email}</p>
      <p style={{ marginTop: 4 }}>Производител в Република България <Box on={!isTrader} /> &nbsp;&nbsp;&nbsp; Търговец <Box on={isTrader} /></p>
      <p style={{ textAlign: "center", fontSize: 12, color: "#555" }}>(вярното се отбелязва с Х)</p>

      <p style={{ textAlign: "center", fontWeight: 700, marginTop: 18 }}>УВАЖАЕМИ ГОСПОДИН ИЗПЪЛНИТЕЛЕН ДИРЕКТОР,</p>

      <p style={{ marginTop: 14 }}>Моля да бъдат регистрирани по чл. 79 от Закона за храните:</p>
      <p style={{ marginTop: 6 }}><Box on={supplement} /> хранителни добавки {supplement ? "1" : "…"} бр.,</p>
      <p style={{ marginTop: 6 }}><Box on={!supplement} /> храни, предназначени за употреба при интензивно мускулно натоварване {!supplement ? "1" : "……"} бр.,</p>
      <p style={{ fontSize: 12, color: "#555" }}>(вярното се отбелязва с Х и се попълва приложение с данни за всяка хранителна добавка по отделно)</p>

      <p style={{ marginTop: 8 }}>и законно се предлагат на пазара на друга държава членка на ЕС <Box on /> не; <Box /> да; <Box /> само някои на територията на ......................................................................</p>
      <p style={{ marginTop: 8 }}>Вид и адрес на обекта за дистрибуция: {distributionAddr || "……………………………"}</p>

      <p style={{ marginTop: 10 }}>Търговия с храни от разстояние <Box on={remote.on} /> да; <Box on={!remote.on} /> не;</p>
      <p style={{ fontSize: 12, color: "#555" }}>Ако отговора е „да“ - описание на начина на търговия с храни от разстояние, включително средствата за комуникация: електронен адрес, интернет страница, телефонен номер, пощенски адрес, електронна поща и други, които ще се използват:</p>
      {remote.on && (
        <div style={{ marginTop: 4 }}>
          {remote.desc && <p>Описание: {remote.desc}</p>}
          {remote.website && <p>Интернет страница: {remote.website}</p>}
          {remote.phone && <p>Телефонен номер: {remote.phone}</p>}
          {remote.email && <p>Електронна поща: {remote.email}</p>}
        </div>
      )}

      {/* --- страница 2 --- */}
      <div style={{ pageBreakBefore: "always", marginTop: 26 }} />
      <p>Хранителната/ите добавка/и и/или храната/ите, предназначена/и за употреба при интензивно мускулно натоварване ще бъдат пуснати на пазара на територията на Република България на: дата</p>
      <div style={{ textAlign: "center" }}><DateCells date={marketDate(submitDate)} /></div>
      <p style={{ textAlign: "center", fontSize: 12, color: "#555" }}>(дата на пускане на пазара, която не може да бъде по-рано от 14 дни от подаване на заявлението)</p>

      <p style={{ marginTop: 14, fontWeight: 700 }}>Прилагам следните документи /отбелязва се с Х/:</p>
      <p style={{ marginTop: 6 }}><Box on /> 1. Приложение списък на хранителните добавки или храната, предназначена за употреба при интензивно мускулно натоварване;</p>
      <p style={{ marginTop: 6 }}><Box on /> 2. Етикет, с който хранителната добавка или храната ще бъде пусната на пазара на територията на Република България – за всеки продукт по отделно;</p>
      <p style={{ marginTop: 6 }}><Box /> 3. Оригинален етикет - когато продуктът не е българско производство – за всеки по отделно;</p>
      <p style={{ marginTop: 6 }}><Box /> 4. Доброволна декларация по чл. 4 от Регламент (ЕС) 2019/515;</p>
      <p style={{ marginTop: 6 }}><Box /> 5. Други, вкл. по чл. 79, ал. 6 от Закон за храните (опиши) ......................................</p>

      <p style={{ marginTop: 14 }}><b><i>ЗАБЕЛЕЖКА:</i></b> <i>Когато заявлението се подава от упълномощено лице към документите, посочени по-горе задължително се прилага оригинал или нотариално заверено копие на <b>пълномощно</b>.</i></p>

      <p style={{ textAlign: "center", fontWeight: 700, marginTop: 16 }}>ДЕКЛАРИРАМ, ЧЕ:</p>
      <ol style={{ marginTop: 8, paddingLeft: 22, listStyleType: "decimal" }}>
        <li style={{ marginBottom: 4 }}>съм запознат с нормативните изисквания, посочени в Закона за храните и подзаконовите нормативни актове, издадени по прилагането му, свързани с дейността, която ще осъществявам;</li>
        <li style={{ marginBottom: 4 }}>съм запознат с приложимото европейско законодателство, свързано с дейността, която ще осъществявам;</li>
        <li style={{ marginBottom: 4 }}>съставът на хранителната добавка/храната, предназначена за употреба при интензивно мускулно натоварване, съответства с информацията на етикета, на изискванията на Наредба за хранителните добавки (Обн. ДВ. бр.106 от 15.12.2021 г.) и/или Наредба № 1 от 22.01.2018 г. за физиологичните норми за хранене на населението, Наредба за специфичните изисквания към храни, предназначени за употреба при интензивно мускулно натоварване, особено при спортисти, включително за отсъствие в състава на вещества, определени в Наредбата по чл. 81 от Закона за храните;</li>
        <li style={{ marginBottom: 4 }}>ми е известно, че при подаване на невярна информация нося наказателна отговорност по чл. 313 от Наказателния кодекс.</li>
        <li style={{ marginBottom: 4 }}>предоставям личните си данни доброволно и давам съгласието си Българската агенция по безопасност на храните да ги обработва, съхранява и използва за изпълнение на законните ѝ интереси и при спазване на разпоредбите на Регламент (ЕС) 2016/679.</li>
      </ol>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26 }}>
        <div>гр. {reg.city}<br />{bgDate(submitDate)} г.<br /><span style={{ fontSize: 12, color: "#555" }}>/дата/</span></div>
        <div style={{ textAlign: "center" }}>ЗАЯВИТЕЛ : ……………………………………<br /><span style={{ fontSize: 12, color: "#555" }}>/подпис/</span></div>
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
