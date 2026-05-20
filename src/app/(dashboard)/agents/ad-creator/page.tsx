/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import useSWR from "swr";
import {
  PenTool, Loader2, Search, Package,
  ChevronRight, ChevronLeft, Check, Camera, FileText,
  Sun, Layers, Download, RefreshCw, Copy, ChevronDown, ChevronUp, Globe,
  Target, Eye, Shield, Microscope, MessageCircle, GraduationCap, Scale,
  Coffee, Mountain, ArrowRight, Flame, Heart, Clapperboard,
  Sparkles, Snowflake, Shuffle, type LucideIcon,
} from "lucide-react";
import { Markdown } from "@/components/shared/Markdown";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// --- Types ---
interface SlimProduct {
  handle: string; title: string; productType: string;
  image: string | null; price: string;
}

type Step = "product" | "settings" | "creative-type" | "generate" | "visuals";

const STEPS: { id: Step; label: string; num: number }[] = [
  { id: "product", label: "Продукт", num: 1 },
  { id: "settings", label: "Настройки", num: 2 },
  { id: "creative-type", label: "Креатив", num: 3 },
  { id: "generate", label: "Копи", num: 4 },
  { id: "visuals", label: "Визуали", num: 5 },
];

// --- Settings ---
const CUSTOM_AVATAR_ID = "custom";
const CUSTOM_AVATAR_MIN_CHARS = 30;

const AVATARS = [
  { id: "Стефан (Performance Seeker, М 28-40)", label: "Стефан", tag: "М 28-40", emoji: "\ud83d\udcaa", desc: "Трениращ, удря плато. Иска данни и наука за натурален тестостерон." },
  { id: "Мария (Health-Conscious Parent, Ж 30-50)", label: "Мария", tag: "Ж 30-50", emoji: "\ud83d\udc69\u200d\ud83d\udc67", desc: "Защитава семейството. Проучва преди покупка, търси доверие." },
  { id: "Петър (Proactive Health Manager, М 35-55)", label: "Петър", tag: "М 35-55", emoji: "\ud83e\ude7a", desc: "Наскоро здравно-осъзнат. Скептичен, иска механизми и обяснения." },
  { id: "Елена (Beauty & Wellness, Ж 25-45)", label: "Елена", tag: "Ж 25-45", emoji: "\u2728", desc: "Външен вид + вътрешно здраве. Instagram-influenced, чисти съставки." },
  { id: "Георги (Loyal Repeater, М 40-65)", label: "Георги", tag: "М 40-65", emoji: "\ud83d\udd04", desc: "Лоялен клиент, купува месечно. Иска удобство и cross-sell." },
  { id: CUSTOM_AVATAR_ID, label: "Свой", tag: "Опиши", emoji: "✍️", desc: "Опиши таргет аудиторията със свои думи: кои са, какво ги вълнува, какво купуват." },
];
const FORMATS = [
  { id: "Meta Feed Ad", label: "Meta Feed" }, { id: "Instagram Stories/Reels", label: "Stories/Reels" },
  { id: "Google Ads", label: "Google Ads" }, { id: "Carousel (3-5 карти, PAS)", label: "Carousel" },
  { id: "Advertorial (дълга форма)", label: "Advertorial" }, { id: "Social Post", label: "Social Post" },
  { id: "Email Subject + Preview", label: "Email" },
];
const ARCHETYPES = [
  { id: "pas", label: "Problem \u2192 Solution", desc: "\u041d\u0430\u0437\u043e\u0432\u0438 \u0431\u043e\u043b\u043a\u0430\u0442\u0430, \u0443\u0441\u0438\u043b\u0438 \u044f, \u0440\u0435\u0448\u0438 \u044f \u0441 \u043f\u0440\u043e\u0434\u0443\u043a\u0442\u0430", icon: Target },
  { id: "mirror", label: "Identity Mirror", desc: "\u041e\u0433\u043b\u0435\u0434\u0430\u043b\u043d\u0438\u044f\u0442 \u043c\u043e\u043c\u0435\u043d\u0442 \u2014 \u043e\u0441\u044a\u0437\u043d\u0430\u0432\u0430\u043d\u0435 \u043d\u0430 \u0440\u0430\u0437\u043b\u0438\u043a\u0430\u0442\u0430", icon: Eye },
  { id: "enemy", label: "Enemy Framing", desc: "\u0412\u044a\u043d\u0448\u0435\u043d \u0432\u0440\u0430\u0433 (\u0441\u0442\u0440\u0435\u0441, \u0442\u043e\u043a\u0441\u0438\u043d\u0438, \u043c\u043e\u0434\u0435\u0440\u0435\u043d \u0436\u0438\u0432\u043e\u0442) + \u043f\u0440\u043e\u0434\u0443\u043a\u0442\u044a\u0442 \u043a\u0430\u0442\u043e \u0441\u044a\u044e\u0437\u043d\u0438\u043a", icon: Shield },
  { id: "ingredient", label: "Ingredient Spotlight", desc: "\u0414\u044a\u043b\u0431\u043e\u043a\u043e \u043f\u043e\u0442\u0430\u043f\u044f\u043d\u0435 \u0432 \u043a\u043b\u044e\u0447\u043e\u0432\u0430 \u0441\u044a\u0441\u0442\u0430\u0432\u043a\u0430 \u2014 \u043d\u0430\u0443\u043a\u0430 + \u043f\u0440\u043e\u0438\u0437\u0445\u043e\u0434", icon: Microscope },
  { id: "ugc", label: "UGC / Testimonial", desc: "Confession \u0441\u0442\u0438\u043b \u2014 \u201e\u0411\u044f\u0445 \u0442\u043e\u0437\u0438 \u0447\u043e\u0432\u0435\u043a, \u043a\u043e\u0439\u0442\u043e...\u201c", icon: MessageCircle },
  { id: "expert", label: "Expert Authority", desc: "\u041b\u0435\u043a\u0430\u0440, \u0444\u0430\u0440\u043c\u0430\u0446\u0435\u0432\u0442 \u0438\u043b\u0438 \u043d\u0443\u0442\u0440\u0438\u0446\u0438\u043e\u043d\u0438\u0441\u0442 \u043e\u0431\u044f\u0441\u043d\u044f\u0432\u0430 \u043c\u0435\u0445\u0430\u043d\u0438\u0437\u043c\u0430", icon: GraduationCap },
  { id: "comparison", label: "Comparison", desc: "\u041d\u0430\u0441 vs. \u043a\u043e\u043d\u043a\u0443\u0440\u0435\u043d\u0446\u0438\u044f\u0442\u0430 \u2014 \u0441\u044a\u0441\u0442\u0430\u0432\u043a\u0438, \u0434\u043e\u0437\u0438\u0440\u043e\u0432\u043a\u0438, \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u043e", icon: Scale },
  { id: "ritual", label: "Routine / Ritual", desc: "\u041f\u0440\u043e\u0434\u0443\u043a\u0442\u044a\u0442 \u043a\u0430\u0442\u043e \u0447\u0430\u0441\u0442 \u043e\u0442 \u0435\u0436\u0435\u0434\u043d\u0435\u0432\u0435\u043d \u0440\u0438\u0442\u0443\u0430\u043b \u0437\u0430 \u0433\u0440\u0438\u0436\u0430", icon: Coffee },
  { id: "origin", label: "Origin Story", desc: "\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u043e \u043d\u0430\u0441\u043b\u0435\u0434\u0441\u0442\u0432\u043e \u2014 845 \u0440\u0430\u0441\u0442\u0435\u043d\u0438\u044f, \u0420\u043e\u0434\u043e\u043f\u0438, \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044f", icon: Mountain },
  { id: "beforeafter", label: "Before / After", desc: "\u0422\u0440\u0430\u043d\u0441\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f \u043d\u0430 \u0418\u0414\u0415\u041d\u0422\u0418\u0427\u041d\u041e\u0421\u0422, \u043d\u0435 \u043d\u0430 \u0442\u044f\u043b\u043e", icon: ArrowRight },
];
const AGGRESSIVENESS_LEVELS = [
  { level: 1, label: "\u041d\u0435\u0436\u043d\u043e", desc: "\u041e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u043d\u043e \u043e\u0441\u044a\u0437\u043d\u0430\u0432\u0430\u043d\u0435 \u0431\u0435\u0437 \u043d\u0430\u0442\u0438\u0441\u043a" },
  { level: 2, label: "\u041f\u0440\u043e\u0431\u043b\u0435\u043c", desc: "\u0418\u0434\u0435\u043d\u0442\u0438\u0444\u0438\u0446\u0438\u0440\u0430 \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u0430, \u043a\u043e\u0439\u0442\u043e \u043f\u043e\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043b\u044f\u0442 \u0443\u0441\u0435\u0449\u0430" },
  { level: 3, label: "\u0411\u043e\u043b\u043a\u0430", desc: "\u0423\u0441\u0438\u043b\u0432\u0430 \u0442\u0440\u0430\u0435\u043a\u0442\u043e\u0440\u0438\u044f\u0442\u0430 \u2014 \u201e\u0432\u0441\u0435\u043a\u0438 \u0434\u0435\u043d \u0431\u0435\u0437 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0435 \u043f\u043e-\u043b\u043e\u0448\u043e\u201c" },
  { level: 4, label: "\u041e\u0433\u043b\u0435\u0434\u0430\u043b\u043e", desc: "\u0414\u0438\u0440\u0435\u043a\u0442\u043d\u0430 \u043a\u043e\u043d\u0444\u0440\u043e\u043d\u0442\u0430\u0446\u0438\u044f \u0441 \u0438\u0434\u0435\u043d\u0442\u0438\u0447\u043d\u043e\u0441\u0442\u0442\u0430" },
  { level: 5, label: "\u041a\u0440\u0438\u0437\u0430", desc: "\u041c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u043d\u0430 \u0441\u043f\u0435\u0448\u043d\u043e\u0441\u0442 \u2014 \u0442\u044f\u043b\u043e\u0442\u043e \u043f\u043e\u0434\u0430\u0432\u0430 \u0441\u0438\u0433\u043d\u0430\u043b \u0421\u0415\u0413\u0410" },
];
const HOOK_STYLES = [
  { id: "question", label: "\u0412\u044a\u043f\u0440\u043e\u0441", desc: "\u201e\u0417\u043d\u0430\u0435\u0448 \u043b\u0438, \u0447\u0435...?\u201c" },
  { id: "stat", label: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430", desc: "\u201e70% \u043e\u0442 \u043c\u044a\u0436\u0435\u0442\u0435 \u0441\u043b\u0435\u0434 25...\u201c" },
  { id: "pain", label: "Pain Call-out", desc: "\u201e\u0410\u043a\u043e \u0441\u0435 \u0441\u044a\u0431\u0443\u0436\u0434\u0430\u0448 \u0443\u043c\u043e\u0440\u0435\u043d...\u201c" },
  { id: "curiosity", label: "Curiosity Gap", desc: "\u201e\u0415\u0434\u0438\u043d\u0441\u0442\u0432\u0435\u043d\u043e\u0442\u043e \u043d\u0435\u0449\u043e, \u043a\u043e\u0435\u0442\u043e...\u201c" },
  { id: "proof", label: "Social Proof", desc: "\u201e23,000+ \u043a\u043b\u0438\u0435\u043d\u0442\u0438 \u0432\u0435\u0447\u0435...\u201c" },
  { id: "humor", label: "Dark Humor", desc: "\u0421\u0430\u043c\u043e\u0438\u0440\u043e\u043d\u0438\u044f, \u043a\u043e\u044f\u0442\u043e \u0447\u0443\u043f\u0438 \u0431\u0430\u0440\u0438\u0435\u0440\u0430\u0442\u0430" },
];
const CREATIVE_TYPES = [
  { id: "Продуктова снимка", label: "Продуктова снимка", desc: "Чист product shot на бял или стилизиран фон", icon: Camera },
  { id: "Научен / Инфо", label: "Научен / Инфо", desc: "Текстова карта с факти и статистики", icon: FileText },
  { id: "Lifestyle", label: "Lifestyle", desc: "Продуктът в контекст — фитнес, кухня, природа", icon: Sun },
  { id: "Lifestyle + текст", label: "Lifestyle + оверлей", desc: "Lifestyle с headline текст върху снимката", icon: Layers },
  { id: "Emotional Scene", label: "Emotional Scene", desc: "Чиста емоция БЕЗ продукт — огледалният момент, осъзнаване, scroll-stopper", icon: Heart },
  { id: "Story Scene", label: "Story Scene", desc: "Наративна сцена с текст оверлей, БЕЗ продукт — история, трансформация", icon: Clapperboard },
];
const AUDIENCES = [
  { id: "Студена (TOFU) — не познават бранда, образователен подход", label: "Студена (TOFU)", desc: "Не познават бранда. Целта: внимание и любопитство." },
  { id: "Топла (MOFU) — знаят за бранда, сравняват опции", label: "Топла (MOFU)", desc: "Знаят за бранда. Целта: доверие и диференциация." },
  { id: "Гореща (BOFU) — готови за покупка, нуждаят се от последния тласък", label: "Гореща (BOFU)", desc: "Готови за покупка. Целта: оферта и действие." },
  { id: "Ретаргетинг — вече са посещавали сайта или купували", label: "Ретаргетинг", desc: "Посещавали сайта / купували. Целта: връщане и cross-sell." },
];
const INTENSITY_LABELS = ["Информативен", "Образователен", "Авторитетен", "Убеждаващ", "Директен"];
const LANGUAGES = [
  { id: "bg", label: "\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438", flag: "\ud83c\udde7\ud83c\uddec" },
  { id: "el", label: "\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac", flag: "\ud83c\uddec\ud83c\uddf7" },
  { id: "ro", label: "Rom\u00e2n\u0103", flag: "\ud83c\uddf7\ud83c\uddf4" },
  { id: "it", label: "Italiano", flag: "\ud83c\uddee\ud83c\uddf9" },
  { id: "de", label: "Deutsch", flag: "\ud83c\udde9\ud83c\uddea" },
  { id: "fr", label: "Fran\u00e7ais", flag: "\ud83c\uddeb\ud83c\uddf7" },
  { id: "en", label: "English", flag: "\ud83c\uddec\ud83c\udde7" },
  { id: "cs", label: "\u010ce\u0161tina", flag: "\ud83c\udde8\ud83c\uddff" },
];
const FORMALITY_OPTIONS = [
  { id: "informal", label: "\u041d\u0435\u0444\u043e\u0440\u043c\u0430\u043b\u043d\u043e (\u0442\u0438/du/tu)" },
  { id: "formal", label: "\u0424\u043e\u0440\u043c\u0430\u043b\u043d\u043e (\u0412\u0438\u0435/Sie/vous)" },
];

// --- Smart Presets ---
// \u041f\u0440\u0438\u043b\u0430\u0433\u0430\u0442 \u043d\u0430\u0431\u043e\u0440 \u043e\u0442 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043d\u0430\u0432\u0435\u0434\u043d\u044a\u0436. Audience/intensity/archetype/aggressiveness/hookStyle/creativeType.
// \u041f\u043e\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043b\u044f\u0442 \u0437\u0430\u043f\u0430\u0437\u0432\u0430 \u043f\u044a\u043b\u0435\u043d \u043a\u043e\u043d\u0442\u0440\u043e\u043b \u0434\u0430 \u043f\u0440\u0435\u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0438\u0440\u0430 \u0432\u0441\u0438\u0447\u043a\u043e \u0441\u043b\u0435\u0434 \u0442\u043e\u0432\u0430.
interface PresetSettings {
  audience: string;
  intensity: number;
  archetype: string;
  aggressiveness: number;
  hookStyle: string;
  creativeType: string;
}
interface Preset { id: string; label: string; icon: LucideIcon; desc: string; settings: PresetSettings; }

const PRESETS: Preset[] = [
  {
    id: "cold-acquisition", label: "Cold Acquisition", icon: Snowflake,
    desc: "TOFU \u2014 \u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u043d\u043e, \u043b\u044e\u0431\u043e\u043f\u0438\u0442\u0441\u0442\u0432\u043e, \u0431\u0435\u0437 \u043d\u0430\u0442\u0438\u0441\u043a",
    settings: {
      audience: "\u0421\u0442\u0443\u0434\u0435\u043d\u0430 (TOFU) \u2014 \u043d\u0435 \u043f\u043e\u0437\u043d\u0430\u0432\u0430\u0442 \u0431\u0440\u0430\u043d\u0434\u0430, \u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u043d \u043f\u043e\u0434\u0445\u043e\u0434",
      intensity: 2, archetype: "ingredient", aggressiveness: 1,
      hookStyle: "curiosity", creativeType: "Lifestyle",
    },
  },
  {
    id: "retargeting-heat", label: "Retargeting Heat", icon: Flame,
    desc: "\u0413\u043e\u0440\u0435\u0449\u0430 \u0440\u0435\u0442\u0430\u0440\u0433\u0435\u0442\u0438\u043d\u0433 \u2014 \u043f\u043e\u0441\u043b\u0435\u0434\u0435\u043d \u0442\u043b\u0430\u0441\u044a\u043a, identity confrontation",
    settings: {
      audience: "\u0420\u0435\u0442\u0430\u0440\u0433\u0435\u0442\u0438\u043d\u0433 \u2014 \u0432\u0435\u0447\u0435 \u0441\u0430 \u043f\u043e\u0441\u0435\u0449\u0430\u0432\u0430\u043b\u0438 \u0441\u0430\u0439\u0442\u0430 \u0438\u043b\u0438 \u043a\u0443\u043f\u0443\u0432\u0430\u043b\u0438",
      intensity: 4, archetype: "mirror", aggressiveness: 4,
      hookStyle: "pain", creativeType: "Story Scene",
    },
  },
  {
    id: "ugc-test", label: "UGC Test", icon: MessageCircle,
    desc: "Confession-style UGC \u0437\u0430 \u0442\u043e\u043f\u043b\u0430 \u0430\u0443\u0434\u0438\u0442\u043e\u0440\u0438\u044f",
    settings: {
      audience: "\u0422\u043e\u043f\u043b\u0430 (MOFU) \u2014 \u0437\u043d\u0430\u044f\u0442 \u0437\u0430 \u0431\u0440\u0430\u043d\u0434\u0430, \u0441\u0440\u0430\u0432\u043d\u044f\u0432\u0430\u0442 \u043e\u043f\u0446\u0438\u0438",
      intensity: 3, archetype: "ugc", aggressiveness: 2,
      hookStyle: "humor", creativeType: "Emotional Scene",
    },
  },
  {
    id: "expert-authority", label: "Expert Authority", icon: GraduationCap,
    desc: "\u041d\u0430\u0443\u0447\u043d\u043e-\u0430\u0432\u0442\u043e\u0440\u0438\u0442\u0435\u0442\u043d\u043e, \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0438, infographic",
    settings: {
      audience: "\u0421\u0442\u0443\u0434\u0435\u043d\u0430 (TOFU) \u2014 \u043d\u0435 \u043f\u043e\u0437\u043d\u0430\u0432\u0430\u0442 \u0431\u0440\u0430\u043d\u0434\u0430, \u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u043d \u043f\u043e\u0434\u0445\u043e\u0434",
      intensity: 3, archetype: "expert", aggressiveness: 2,
      hookStyle: "stat", creativeType: "\u041d\u0430\u0443\u0447\u0435\u043d / \u0418\u043d\u0444\u043e",
    },
  },
  {
    id: "origin-story", label: "Origin Story", icon: Mountain,
    desc: "\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u043e \u043d\u0430\u0441\u043b\u0435\u0434\u0441\u0442\u0432\u043e \u2014 \u0420\u043e\u0434\u043e\u043f\u0438, \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044f, USP",
    settings: {
      audience: "\u0422\u043e\u043f\u043b\u0430 (MOFU) \u2014 \u0437\u043d\u0430\u044f\u0442 \u0437\u0430 \u0431\u0440\u0430\u043d\u0434\u0430, \u0441\u0440\u0430\u0432\u043d\u044f\u0432\u0430\u0442 \u043e\u043f\u0446\u0438\u0438",
      intensity: 3, archetype: "origin", aggressiveness: 2,
      hookStyle: "curiosity", creativeType: "Lifestyle",
    },
  },
];

// --- Progress Bar ---
function ProgressBar({ current, onNavigate }: { current: Step; onNavigate: (s: Step) => void }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
      {STEPS.map((s, i) => {
        const isCompleted = i < currentIdx;
        const isActive = s.id === current;
        return (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => isCompleted ? onNavigate(s.id) : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium transition-all min-h-[40px] ${
                isActive ? "bg-purple text-white shadow-sm" :
                isCompleted ? "bg-purple-soft text-purple cursor-pointer hover:bg-purple/20" :
                "bg-surface-2 text-text-2"
              }`}
            >
              {isCompleted ? <Check size={14} /> : <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">{s.num}</span>}
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <ChevronRight size={14} className="text-text-3 mx-1 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// --- Pill selector ---
function PillGroup<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-text mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button key={opt.id} onClick={() => onChange(opt.id)}
            className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-all cursor-pointer min-h-[40px] ${
              value === opt.id ? "bg-purple text-white shadow-sm" : "bg-surface-2 text-text-2 hover:bg-border/40"
            }`}
          >{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

// --- Step 1: Product ---
function ProductStep({ selected, onSelect }: { selected: SlimProduct | null; onSelect: (p: SlimProduct) => void }) {
  const { data } = useSWR<{ products: SlimProduct[] }>("/api/products/catalog", fetcher, { revalidateOnFocus: false });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => {
    if (!data?.products) return [];
    const cats = new Map<string, number>();
    data.products.forEach((p) => { const c = p.productType || "Друго"; cats.set(c, (cats.get(c) || 0) + 1); });
    return Array.from(cats.entries()).sort((a, b) => b[1] - a[1]);
  }, [data?.products]);

  const filtered = useMemo(() => {
    if (!data?.products) return [];
    let products = data.products;
    if (category !== "all") products = products.filter((p) => (p.productType || "Друго") === category);
    if (search) { const q = search.toLowerCase(); products = products.filter((p) => p.title.toLowerCase().includes(q)); }
    return products;
  }, [data?.products, category, search]);

  return (
    <div>
      <h2 className="text-[18px] font-semibold text-text mb-1">Избери продукт</h2>
      <p className="text-[13px] text-text-2 mb-4">За кой продукт ще правим реклама?</p>

      <div className="space-y-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Търси продукт..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface-2 border border-border text-[13px] text-text outline-none focus:border-purple"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setCategory("all")} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer min-h-[34px] ${category === "all" ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>Всички</button>
          {categories.map(([cat, count]) => (
            <button key={cat} onClick={() => setCategory(cat)} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer min-h-[34px] ${category === cat ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>{cat} ({count})</button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-12 text-text-2"><Loader2 size={20} className="animate-spin mr-2" />Зареждам каталога...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((p) => (
            <button key={p.handle} onClick={() => onSelect(p)}
              className={`group bg-surface rounded-xl overflow-hidden text-left transition-all cursor-pointer border-2 ${
                selected?.handle === p.handle ? "border-purple ring-2 ring-purple/20" : "border-transparent hover:border-purple/30"
              }`}
            >
              {p.image ? (
                <img src={p.image} alt="" className="w-full aspect-square object-contain bg-surface-2" />
              ) : (
                <div className="w-full aspect-square bg-surface-2 flex items-center justify-center"><Package size={24} className="text-text-3" /></div>
              )}
              <div className="p-2.5">
                <div className="text-[12px] font-medium text-text line-clamp-2 leading-tight mb-1">{p.title}</div>
                <div className="text-[12px] font-semibold text-purple">{parseFloat(p.price).toFixed(2)} EUR</div>
              </div>
              {selected?.handle === p.handle && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-purple flex items-center justify-center"><Check size={14} className="text-white" /></div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Step 2: Settings ---
function SettingsStep({ avatar, setAvatar, format, setFormat, audience, setAudience, intensity, setIntensity, additionalInput, setAdditionalInput, language, setLanguage, formality, setFormality, customAvatarDescription, setCustomAvatarDescription, applyPreset, appliedPresetId }: {
  avatar: string; setAvatar: (v: string) => void; format: string; setFormat: (v: string) => void;
  audience: string; setAudience: (v: string) => void;
  intensity: number; setIntensity: (v: number) => void;
  additionalInput: string; setAdditionalInput: (v: string) => void;
  language: string; setLanguage: (v: string) => void;
  formality: string; setFormality: (v: string) => void;
  customAvatarDescription: string; setCustomAvatarDescription: (v: string) => void;
  applyPreset: (p: Preset) => void; appliedPresetId: string | null;
}) {
  const customCharCount = customAvatarDescription.trim().length;
  const customRemaining = Math.max(0, CUSTOM_AVATAR_MIN_CHARS - customCharCount);
  return (
    <div>
      <h2 className="text-[18px] font-semibold text-text mb-1">Настрой кампанията</h2>
      <p className="text-[13px] text-text-2 mb-5">За кого е рекламата и в какъв формат?</p>

      <div className="space-y-5">
        {/* Smart presets — applies audience/intensity/archetype/aggressiveness/hookStyle/creativeType in one click */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-2 flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple" />Бърз старт <span className="text-text-3 font-normal">(прилага комбинация от настройки; може да преконфигурираш всичко)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const Icon = p.icon;
              const isApplied = appliedPresetId === p.id;
              return (
                <button key={p.id} onClick={() => applyPreset(p)} title={p.desc}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-all cursor-pointer min-h-[40px] border ${
                    isApplied ? "bg-purple text-white border-purple shadow-sm" : "bg-surface-2 text-text-2 border-transparent hover:bg-purple/10 hover:text-purple hover:border-purple/30"
                  }`}
                >
                  <Icon size={12} />{p.label}
                  {isApplied && <Check size={12} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Language selector */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-2 flex items-center gap-1.5"><Globe size={14} />Език на рекламата</div>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.map((l) => (
              <button key={l.id} onClick={() => setLanguage(l.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-all cursor-pointer min-h-[40px] ${
                  language === l.id ? "bg-purple text-white shadow-sm" : "bg-surface-2 text-text-2 hover:bg-border/40"
                }`}
              ><span>{l.flag}</span>{l.label}</button>
            ))}
          </div>
        </div>

        {/* Formality toggle */}
        <PillGroup options={FORMALITY_OPTIONS} value={formality} onChange={setFormality} label="Обръщение" />
        {/* Avatar cards — 5 предефинирани + Custom */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-2">Аватар — за кого пишем?</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {AVATARS.map((a) => {
              const isCustom = a.id === CUSTOM_AVATAR_ID;
              const isSelected = avatar === a.id;
              return (
                <button key={a.id} onClick={() => setAvatar(a.id)}
                  className={`flex flex-col items-center text-center p-4 rounded-xl transition-all cursor-pointer border-2 ${
                    isSelected ? "border-purple bg-purple/5 ring-2 ring-purple/20" : isCustom ? "border-dashed border-border bg-surface hover:border-purple/40" : "border-border bg-surface hover:border-purple/30"
                  }`}
                >
                  <span className="text-[28px] mb-2">{a.emoji}</span>
                  <span className={`text-[13px] font-semibold ${isSelected ? "text-purple" : "text-text"}`}>{a.label}</span>
                  <span className="text-[12px] text-text-2 mb-1.5">{a.tag}</span>
                  <p className="text-[11px] text-text-2 leading-snug">{a.desc}</p>
                </button>
              );
            })}
          </div>

          {avatar === CUSTOM_AVATAR_ID && (
            <div className="mt-3 p-4 rounded-xl bg-purple/5 border border-purple/20">
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="custom-avatar" className="text-[12px] font-semibold text-text">
                  Опиши таргета на тази реклама
                </label>
                <span className={`text-[11px] ${customRemaining > 0 ? "text-text-3" : "text-purple"}`}>
                  {customRemaining > 0 ? `още ${customRemaining} символа` : `${customCharCount} символа ✓`}
                </span>
              </div>
              <textarea
                id="custom-avatar"
                value={customAvatarDescription}
                onChange={(e) => setCustomAvatarDescription(e.target.value)}
                placeholder="Напр. Жени 35-50, които наскоро родиха второ дете. Опитват се да възстановят формата си, но времето е дефицит. Скептични към fitness индустрията, доверяват се на доказателства и природни състави."
                rows={4}
                className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-[13px] text-text outline-none focus:border-purple resize-none"
              />
              <p className="text-[11px] text-text-3 mt-2 leading-snug">
                Колкото по-конкретно (възраст, пол, болка, какво вече купуват, какво ги спира), толкова по-точно копи. Минимум {CUSTOM_AVATAR_MIN_CHARS} символа.
              </p>
            </div>
          )}
        </div>

        <PillGroup options={FORMATS} value={format} onChange={setFormat} label="Формат на рекламата" />

        {/* Audience temperature */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-2">Аудитория — къде са във фунията?</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {AUDIENCES.map((a) => (
              <button key={a.id} onClick={() => setAudience(a.id)}
                className={`p-3 rounded-xl text-left transition-all cursor-pointer border-2 ${
                  audience === a.id ? "border-purple bg-purple/5 ring-2 ring-purple/20" : "border-border bg-surface hover:border-purple/30"
                }`}
              >
                <span className={`text-[13px] font-semibold block ${audience === a.id ? "text-purple" : "text-text"}`}>{a.label}</span>
                <p className="text-[11px] text-text-2 leading-snug mt-1">{a.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[13px] font-semibold text-text mb-2">Интензивност: {intensity}/5 — {INTENSITY_LABELS[intensity - 1]}</div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((level) => (
              <button key={level} onClick={() => setIntensity(level)} className={`flex-1 h-3 rounded-full transition-all cursor-pointer ${level <= intensity ? "bg-purple" : "bg-surface-2"}`} />
            ))}
          </div>
        </div>

        <div>
          <div className="text-[13px] font-semibold text-text mb-2">Допълнителни инструкции <span className="font-normal text-text-3">(незадължително)</span></div>
          <textarea value={additionalInput} onChange={(e) => setAdditionalInput(e.target.value)}
            placeholder="Напр. фокусирай се върху съставката ашваганда, спомени промоция 2+1..."
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-border text-[13px] text-text outline-none focus:border-purple resize-none"
          />
        </div>
      </div>
    </div>
  );
}

// --- Step 3: Creative Settings ---
function CreativeStep({ creativeType, setCreativeType, archetype, setArchetype, aggressiveness, setAggressiveness, hookStyle, setHookStyle, horizontalAB, setHorizontalAB }: {
  creativeType: string; setCreativeType: (v: string) => void;
  archetype: string; setArchetype: (v: string) => void;
  aggressiveness: number; setAggressiveness: (v: number) => void;
  hookStyle: string; setHookStyle: (v: string) => void;
  horizontalAB: boolean; setHorizontalAB: (v: boolean) => void;
}) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold text-text mb-1">Креативна стратегия</h2>
      <p className="text-[13px] text-text-2 mb-5">Визуален стил, рамка, агресивност и hook</p>

      <div className="space-y-6">
        {/* Visual Type */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-2">Визуален стил</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CREATIVE_TYPES.map((ct) => {
              const Icon = ct.icon;
              const isSelected = creativeType === ct.id;
              return (
                <button key={ct.id} onClick={() => setCreativeType(ct.id)}
                  className={`flex items-start gap-4 p-4 rounded-xl text-left transition-all cursor-pointer border-2 ${
                    isSelected ? "border-purple bg-purple/5 ring-2 ring-purple/20" : "border-border bg-surface hover:border-purple/30"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className={`text-[13px] font-semibold ${isSelected ? "text-purple" : "text-text"}`}>{ct.label}</div>
                    <p className="text-[11px] text-text-2 mt-0.5">{ct.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Creative Archetype */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-2">Creative Archetype — рамка на рекламата</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ARCHETYPES.map((a) => {
              const Icon = a.icon;
              const isSelected = archetype === a.id;
              return (
                <button key={a.id} onClick={() => setArchetype(a.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl text-left transition-all cursor-pointer border-2 ${
                    isSelected ? "border-purple bg-purple/5 ring-2 ring-purple/20" : "border-border bg-surface hover:border-purple/30"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[12px] font-semibold ${isSelected ? "text-purple" : "text-text"}`}>{a.label}</div>
                    <p className="text-[11px] text-text-2 leading-snug truncate">{a.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Aggressiveness */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-1 flex items-center gap-1.5">
            <Flame size={14} />Агресивност: {aggressiveness}/5 — {AGGRESSIVENESS_LEVELS[aggressiveness - 1].label}
          </div>
          <p className="text-[11px] text-text-2 mb-2">{AGGRESSIVENESS_LEVELS[aggressiveness - 1].desc}</p>
          <div className="flex gap-1.5">
            {AGGRESSIVENESS_LEVELS.map((al) => (
              <button key={al.level} onClick={() => setAggressiveness(al.level)}
                className={`flex-1 h-3 rounded-full transition-all cursor-pointer ${al.level <= aggressiveness ? "bg-red" : "bg-surface-2"}`}
              />
            ))}
          </div>
        </div>

        {/* Hook Style */}
        <div>
          <div className="text-[13px] font-semibold text-text mb-2">Hook стил — първите 3 секунди</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {HOOK_STYLES.map((h) => (
              <button key={h.id} onClick={() => setHookStyle(h.id)}
                className={`p-3 rounded-xl text-left transition-all cursor-pointer border-2 ${
                  hookStyle === h.id ? "border-purple bg-purple/5 ring-2 ring-purple/20" : "border-border bg-surface hover:border-purple/30"
                }`}
              >
                <span className={`text-[12px] font-semibold block ${hookStyle === h.id ? "text-purple" : "text-text"}`}>{h.label}</span>
                <p className="text-[11px] text-text-2 leading-snug mt-0.5">{h.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Horizontal A/B toggle — 4 различни archetype-а вместо 4 варианта на същия */}
        <div>
          <button onClick={() => setHorizontalAB(!horizontalAB)}
            className={`w-full flex items-start gap-3 p-4 rounded-xl text-left transition-all cursor-pointer border-2 ${
              horizontalAB ? "border-purple bg-purple/5 ring-2 ring-purple/20" : "border-border bg-surface hover:border-purple/30"
            }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${horizontalAB ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>
              <Shuffle size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className={`text-[13px] font-semibold ${horizontalAB ? "text-purple" : "text-text"}`}>Horizontal A/B — 4 различни archetype-а</span>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${horizontalAB ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>
                  {horizontalAB ? "ON" : "OFF"}
                </span>
              </div>
              <p className="text-[11px] text-text-2 leading-snug">
                Когато е включено: всеки от 4-те варианта ще използва различен archetype (избраният + 3 комплементарни). Хоризонтално изследване за A/B тестване вместо 4 версии на същата рамка.
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Variant parser ---
interface Variant {
  name: string; hook: string; body: string; headline: string;
  cta: string; visualDirection: string; imagePrompt: string;
}

function parseVariants(content: string): Variant[] {
  const variants: Variant[] = [];
  // Match variant headers in any language: "## Вариант A", "## Variante A", "## Variant A", "## Παραλλαγή A", "## Varianta A", "## Variante A"
  const sections = content.split(/^## (?:Вариант|Variant[eai]?|Varianta|Παραλλαγή|Варианта) /m).slice(1);
  for (const section of sections) {
    const nameMatch = section.match(/^([A-DА-Д][^:\n]*)/);
    const name = nameMatch ? nameMatch[1].replace(/[:#]/g, "").trim() : "Variant";
    const extract = (labels: string[], preserveNewlines = false): string => {
      for (const label of labels) {
        const regex = new RegExp(`\\*\\*${label}[^*]*\\*\\*[:\\s]*\\n?([\\s\\S]*?)(?=\\n\\*\\*|\\n---|$)`, "i");
        const match = section.match(regex);
        if (match && match[1].trim()) return preserveNewlines ? match[1].trim() : match[1].trim().replace(/\n+/g, " ");
      }
      return "";
    };
    variants.push({
      name,
      hook: extract(["Hook"]),
      body: extract(["Основен текст", "Testo principale", "Haupttext", "Main text", "Texte principal", "Texto principal", "Κύριο κείμενο", "Text principal", "Hlavní text"], true),
      headline: extract(["Headline", "Titolo", "Überschrift", "Titre", "Τίτλος", "Titlu", "Nadpis"]),
      cta: extract(["CTA", "Call to action"]),
      visualDirection: extract(["Визуална насока", "Indicazioni visive", "Visual direction", "Visuelle Richtung", "Direction visuelle", "Οπτική κατεύθυνση", "Direcție vizuală", "Vizuální směr"], true),
      imagePrompt: extract(["Image Prompt"]),
    });
  }
  return variants;
}

// --- Step 4: Generate Copy ---
function GenerateStep({ product, avatar, format, audience, intensity, creativeType, archetype, aggressiveness, hookStyle, generatedContent, setGeneratedContent, variants, setVariants, selectedVariants, setSelectedVariants, additionalInput, hasCopyGenerated, setHasCopyGenerated, language, formality, customAvatarDescription, horizontalAB }: {
  product: SlimProduct; avatar: string; format: string;
  audience: string; intensity: number; creativeType: string;
  archetype: string; aggressiveness: number; hookStyle: string;
  generatedContent: string; setGeneratedContent: (v: string) => void;
  variants: Variant[]; setVariants: (v: Variant[]) => void;
  selectedVariants: Set<number>; setSelectedVariants: (v: Set<number>) => void;
  additionalInput: string;
  hasCopyGenerated: boolean; setHasCopyGenerated: (v: boolean) => void;
  language: string; formality: string;
  customAvatarDescription: string;
  horizontalAB: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [expandedVariant, setExpandedVariant] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setGeneratedContent("");
    setVariants([]);
    setSelectedVariants(new Set());

    const avatarLabel = avatar === CUSTOM_AVATAR_ID
      ? "Custom (виж секцията ЦЕЛЕВИ АВАТАР в системния промпт)"
      : (AVATARS.find((a) => a.id === avatar)?.label || avatar);

    const archetypeLabel = horizontalAB
      ? `${ARCHETYPES.find((a) => a.id === archetype)?.label} + 3 комплементарни (Horizontal A/B)`
      : ARCHETYPES.find((a) => a.id === archetype)?.label;

    const settingsContext = [
      `[Настройки: Аватар: ${avatarLabel}`,
      `Формат: ${FORMATS.find((f) => f.id === format)?.label}`,
      `Аудитория: ${AUDIENCES.find((a) => a.id === audience)?.label}`,
      `Archetype: ${archetypeLabel}`,
      `Агресивност: ${aggressiveness}/5`,
      `Hook стил: ${HOOK_STYLES.find((h) => h.id === hookStyle)?.label}`,
      `Интензивност: ${intensity}/5`,
      `Продукт: ${product.title} (handle: ${product.handle})`,
      `Тип креатив: ${creativeType}]`,
    ].join(", ");

    const userMessage = additionalInput.trim()
      ? `${settingsContext}\n\n${additionalInput.trim()}`
      : `${settingsContext}\n\nСъздай 4 варианта на рекламно копи за този продукт с избраните настройки. Включи Image Prompt за всеки вариант.`;

    try {
      const res = await fetch("/api/agents/ad-creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
          avatar, format, intensity, audience,
          product: product.handle,
          creativeType, archetype, aggressiveness, hookStyle,
          language, formality, horizontalAB,
          customAvatarDescription: avatar === CUSTOM_AVATAR_ID ? customAvatarDescription.trim() : "",
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        throw new Error(`API ${res.status}: ${errText}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.t === "text") { accumulated += evt.d; setGeneratedContent(accumulated); }
            if (evt.t === "replace") { accumulated = evt.content; setGeneratedContent(accumulated); }
          } catch { /* skip */ }
        }
      }
      const parsed = parseVariants(accumulated);
      setVariants(parsed);
      if (parsed.length > 0) setSelectedVariants(new Set(parsed.map((_, i) => i)));
    } catch {
      setGeneratedContent("\u26a0\ufe0f Грешка при генериране. Опитай отново.");
    }
    setLoading(false);
  }, [product, avatar, format, audience, intensity, creativeType, archetype, aggressiveness, hookStyle, additionalInput, language, formality, customAvatarDescription, horizontalAB, setGeneratedContent, setVariants, setSelectedVariants]);

  // Auto-generate only on first visit, not when navigating back
  useEffect(() => {
    if (!hasCopyGenerated && !loading) {
      setHasCopyGenerated(true);
      generate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVariant = (idx: number) => {
    const next = new Set(selectedVariants);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelectedVariants(next);
  };

  const copyVariant = (v: Variant, idx: number) => {
    const text = [v.hook && `Hook: ${v.hook}`, v.headline && `Headline: ${v.headline}`, v.body, v.cta && `CTA: ${v.cta}`].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const labels = ["A", "B", "C", "D"];
  const isExpanded = (i: number) => expandedVariant === i;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[18px] font-semibold text-text mb-1">Рекламно копи</h2>
          <p className="text-[13px] text-text-2">{variants.length > 0 ? `${variants.length} варианта — избери кои да генерираш визуали` : "Генерирам варианти..."}</p>
        </div>
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 hover:bg-border/40 text-[12px] font-medium text-text-2 cursor-pointer transition-all min-h-[40px]"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{loading ? "Генерирам..." : "Регенерирай"}
        </button>
      </div>

      {loading && variants.length === 0 ? (
        <div className="flex items-center gap-3 text-text-2 py-12 justify-center">
          <Loader2 size={18} className="animate-spin" /><span className="text-[14px]">Създавам 4 варианта...</span>
        </div>
      ) : variants.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {variants.map((v, i) => {
            const sel = selectedVariants.has(i);
            const expanded = isExpanded(i);
            return (
              <div key={i}
                className={`text-left bg-surface rounded-xl overflow-hidden transition-all border-2 ${sel ? "border-purple ring-2 ring-purple/20" : "border-border hover:border-purple/30"}`}
              >
                <div className="p-4">
                  {/* Header row: label + name + action buttons */}
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => toggleVariant(i)} className="flex items-center gap-2 cursor-pointer">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-bold ${sel ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>{labels[i] || i + 1}</span>
                      <span className="text-[13px] font-semibold text-text">{v.name}</span>
                      {sel && <Check size={14} className="text-purple" />}
                    </button>
                    <div className="flex items-center gap-1">
                      <button onClick={() => copyVariant(v, i)} title="Копирай текста"
                        className="p-2 rounded-lg hover:bg-surface-2 text-text-3 hover:text-purple cursor-pointer transition-all"
                      >
                        {copiedIdx === i ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                      </button>
                      <button onClick={() => setExpandedVariant(expanded ? null : i)} title={expanded ? "Свий" : "Разгъни"}
                        className="p-2 rounded-lg hover:bg-surface-2 text-text-3 hover:text-purple cursor-pointer transition-all"
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Hook - always visible */}
                  {v.hook && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-text-2 mb-0.5">Hook</div>
                      <p className="text-[12px] text-text leading-snug bg-purple-soft rounded-lg px-3 py-2">{v.hook}</p>
                    </div>
                  )}
                  {v.headline && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-text-2 mb-0.5">Headline</div>
                      <p className="text-[13px] font-semibold text-text">{v.headline}</p>
                    </div>
                  )}

                  {/* Body - collapsed by default, full on expand */}
                  {v.body && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-text-2 mb-0.5">Текст</div>
                      <div className={`text-[12px] text-text-2 leading-relaxed whitespace-pre-line ${expanded ? "" : "line-clamp-4"}`}>{v.body}</div>
                    </div>
                  )}

                  {/* Visual direction - only when expanded */}
                  {expanded && v.visualDirection && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-text-2 mb-0.5">Визуална насока</div>
                      <div className="text-[12px] text-text-2 leading-relaxed whitespace-pre-line">{v.visualDirection}</div>
                    </div>
                  )}

                  {v.cta && <span className="inline-block mt-1 px-3 py-1.5 rounded-full bg-surface-2 text-[12px] font-medium text-text">{v.cta}</span>}

                  {/* Expand hint when collapsed */}
                  {!expanded && v.body && v.body.length > 200 && (
                    <button onClick={() => setExpandedVariant(i)} className="mt-2 text-[12px] text-purple hover:underline cursor-pointer">
                      Покажи целия текст
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : generatedContent ? (
        <div className="bg-surface rounded-xl border border-border p-5"><Markdown text={generatedContent} /></div>
      ) : null}
    </div>
  );
}

// --- Step 5: Visuals ---
function VisualsStep({ variants, selectedVariants, format, productImageUrl, creativeType, images, setImages, language, archetype }: {
  variants: Variant[]; selectedVariants: Set<number>; format: string; productImageUrl: string | null; creativeType: string;
  images: { variant: Variant; image: string | null; loading: boolean; error: string | null }[];
  setImages: React.Dispatch<React.SetStateAction<{ variant: Variant; image: string | null; loading: boolean; error: string | null }[]>>;
  language: string; archetype: string;
}) {
  const selected = useMemo(() => variants.filter((_, i) => selectedVariants.has(i)), [variants, selectedVariants]);
  const [generating, setGenerating] = useState(false);

  const generateAll = useCallback(async () => {
    if (selected.length === 0) return;
    setGenerating(true);
    setImages(selected.map((v) => ({ variant: v, image: null, loading: true, error: null })));
    for (let i = 0; i < selected.length; i++) {
      try {
        const res = await fetch("/api/agents/ad-creator/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: selected[i].imagePrompt, format, creativeType, headline: selected[i].headline || selected[i].hook, language, archetype,
            productImageUrl: (creativeType === "Emotional Scene" || creativeType === "Story Scene") ? null : productImageUrl,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setImages((prev) => prev.map((img, j) => j === i ? { ...img, image: data.image, loading: false } : img));
      } catch (err) {
        setImages((prev) => prev.map((img, j) => j === i ? { ...img, loading: false, error: String(err) } : img));
      }
    }
    setGenerating(false);
  }, [selected, format, productImageUrl, creativeType, language, archetype]);

  // Auto-generate only on first visit, not when navigating back
  useEffect(() => {
    if (selected.length > 0 && images.length === 0) {
      generateAll();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadImage = (base64: string, name: string) => {
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${base64}`;
    link.download = `cvetita-${name.replace(/\s+/g, "-").toLowerCase()}.png`;
    link.click();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[18px] font-semibold text-text mb-1">Визуали</h2>
          <p className="text-[13px] text-text-2">{selected.length} креатива от Gemini AI{productImageUrl ? " с продуктова снимка" : ""}</p>
        </div>
        <button onClick={generateAll} disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 hover:bg-border/40 text-[12px] font-medium text-text-2 cursor-pointer transition-all min-h-[40px]"
        >
          <RefreshCw size={14} className={generating ? "animate-spin" : ""} />{generating ? "Генерирам..." : "Регенерирай"}
        </button>
      </div>

      {selected.length === 0 ? (
        <div className="text-center py-12 text-text-2">
          <Camera size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-[14px]">Не са избрани варианти.</p>
          <p className="text-[12px] mt-1">Върни се на стъпка 4 и избери поне един.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {images.map((img, i) => (
            <div key={i} className="bg-surface rounded-xl border border-border overflow-hidden">
              {img.loading ? (
                <div className="aspect-square flex items-center justify-center bg-surface-2">
                  <div className="text-center">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2 text-purple" />
                    <p className="text-[13px] text-text-2">Генерирам: {img.variant.name}...</p>
                  </div>
                </div>
              ) : img.error ? (
                <div className="aspect-square flex items-center justify-center bg-surface-2 p-4">
                  <p className="text-[12px] text-red text-center">{img.error}</p>
                </div>
              ) : img.image ? (
                <img src={`data:image/png;base64,${img.image}`} alt={img.variant.name} className="w-full aspect-square object-contain bg-white" />
              ) : null}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-semibold text-text">{img.variant.name}</span>
                  {img.image && (
                    <button onClick={() => downloadImage(img.image!, img.variant.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple text-white text-[12px] font-medium cursor-pointer hover:bg-purple/90 transition-all"
                    >
                      <Download size={12} />Изтегли
                    </button>
                  )}
                </div>
                {img.variant.hook && <p className="text-[12px] text-text-2 line-clamp-2">{img.variant.hook}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Wizard ---
export default function AdCreatorPage() {
  const [step, setStep] = useState<Step>("product");
  const [selectedProduct, setSelectedProduct] = useState<SlimProduct | null>(null);
  const [avatar, setAvatar] = useState(AVATARS[0].id);
  const [customAvatarDescription, setCustomAvatarDescription] = useState("");
  const [format, setFormat] = useState(FORMATS[0].id);
  const [intensity, setIntensity] = useState(3);
  const [audience, setAudience] = useState(AUDIENCES[0].id);
  const [archetype, setArchetype] = useState("pas");
  const [aggressiveness, setAggressiveness] = useState(3);
  const [hookStyle, setHookStyle] = useState("curiosity");
  const [creativeType, setCreativeType] = useState(CREATIVE_TYPES[0].id);
  const [language, setLanguage] = useState("bg");
  const [formality, setFormality] = useState("informal");
  const [generatedContent, setGeneratedContent] = useState("");
  const [additionalInput, setAdditionalInput] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariants, setSelectedVariants] = useState<Set<number>>(new Set());
  const [hasCopyGenerated, setHasCopyGenerated] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{ variant: Variant; image: string | null; loading: boolean; error: string | null }[]>([]);
  const [horizontalAB, setHorizontalAB] = useState(false);
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);

  const applyPreset = useCallback((preset: Preset) => {
    setAudience(preset.settings.audience);
    setIntensity(preset.settings.intensity);
    setArchetype(preset.settings.archetype);
    setAggressiveness(preset.settings.aggressiveness);
    setHookStyle(preset.settings.hookStyle);
    setCreativeType(preset.settings.creativeType);
    setAppliedPresetId(preset.id);
  }, []);

  const canNext: Record<Step, boolean> = {
    product: !!selectedProduct,
    settings: avatar !== CUSTOM_AVATAR_ID || customAvatarDescription.trim().length >= CUSTOM_AVATAR_MIN_CHARS,
    "creative-type": true,
    generate: variants.length > 0 && selectedVariants.size > 0,
    visuals: false,
  };

  const nextStep = () => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx < STEPS.length - 1 && canNext[step]) setStep(STEPS[idx + 1].id);
  };
  const prevStep = () => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx > 0) setStep(STEPS[idx - 1].id);
  };
  const navigateTo = (s: Step) => {
    const targetIdx = STEPS.findIndex((st) => st.id === s);
    const currentIdx = STEPS.findIndex((st) => st.id === step);
    if (targetIdx < currentIdx) setStep(s);
  };

  return (
    <div className="flex flex-col pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-xl bg-purple flex items-center justify-center flex-shrink-0">
          <PenTool size={16} className="text-white" />
        </div>
        <div>
          <h1 className="text-[16px] font-semibold text-text">Рекламен Творец</h1>
          <p className="text-[13px] text-text-2">Стъпка по стъпка до готов креатив</p>
        </div>
        {selectedProduct && step !== "product" && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2">
            {selectedProduct.image && <img src={selectedProduct.image} alt="" className="w-6 h-6 rounded object-contain bg-white" />}
            <span className="text-[12px] font-medium text-text max-w-[120px] truncate">{selectedProduct.title}</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <ProgressBar current={step} onNavigate={navigateTo} />

      {/* Step content */}
      <div>
        {step === "product" && <ProductStep selected={selectedProduct} onSelect={setSelectedProduct} />}
        {step === "settings" && (
          <SettingsStep avatar={avatar} setAvatar={setAvatar} format={format} setFormat={setFormat}
            audience={audience} setAudience={setAudience}
            intensity={intensity} setIntensity={setIntensity}
            additionalInput={additionalInput} setAdditionalInput={setAdditionalInput}
            language={language} setLanguage={setLanguage}
            formality={formality} setFormality={setFormality}
            customAvatarDescription={customAvatarDescription}
            setCustomAvatarDescription={setCustomAvatarDescription}
            applyPreset={applyPreset} appliedPresetId={appliedPresetId}
          />
        )}
        {step === "creative-type" && (
          <CreativeStep creativeType={creativeType} setCreativeType={setCreativeType}
            archetype={archetype} setArchetype={setArchetype}
            aggressiveness={aggressiveness} setAggressiveness={setAggressiveness}
            hookStyle={hookStyle} setHookStyle={setHookStyle}
            horizontalAB={horizontalAB} setHorizontalAB={setHorizontalAB}
          />
        )}
        {step === "generate" && selectedProduct && (
          <GenerateStep product={selectedProduct} avatar={avatar} format={format}
            audience={audience} intensity={intensity} creativeType={creativeType}
            archetype={archetype} aggressiveness={aggressiveness} hookStyle={hookStyle}
            generatedContent={generatedContent} setGeneratedContent={setGeneratedContent}
            variants={variants} setVariants={setVariants}
            selectedVariants={selectedVariants} setSelectedVariants={setSelectedVariants}
            additionalInput={additionalInput}
            hasCopyGenerated={hasCopyGenerated} setHasCopyGenerated={setHasCopyGenerated}
            language={language} formality={formality}
            customAvatarDescription={customAvatarDescription}
            horizontalAB={horizontalAB}
          />
        )}
        {step === "visuals" && (
          <VisualsStep variants={variants} selectedVariants={selectedVariants} format={format}
            productImageUrl={selectedProduct?.image || null} creativeType={creativeType}
            images={generatedImages} setImages={setGeneratedImages}
            language={language} archetype={archetype}
          />
        )}
      </div>

      {/* Navigation buttons */}
      <div className="fixed bottom-0 left-0 right-0 md:left-[var(--sidebar-width)] bg-surface/95 backdrop-blur-sm border-t border-border p-4 flex items-center justify-between z-10">
        <button onClick={prevStep} disabled={step === "product"}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium min-h-[44px] transition-all ${
            step === "product" ? "text-text-3 cursor-not-allowed" : "bg-surface-2 text-text-2 hover:bg-border/40 cursor-pointer"
          }`}
        >
          <ChevronLeft size={16} />Назад
        </button>

        {step !== "visuals" ? (
          <button onClick={nextStep} disabled={!canNext[step]}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-medium min-h-[44px] transition-all ${
              canNext[step] ? "bg-purple text-white hover:bg-purple/90 cursor-pointer shadow-sm" : "bg-surface-2 text-text-3 cursor-not-allowed"
            }`}
          >
            Напред<ChevronRight size={16} />
          </button>
        ) : (
          <div className="text-[13px] text-text-2">Изтегли креативите или регенерирай</div>
        )}
      </div>
    </div>
  );
}
