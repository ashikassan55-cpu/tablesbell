'use client';

/**
 * src/components/providers/guest-locale-provider.tsx
 *
 * Bilingual (EN / عربي) + RTL for the guest ordering surface, from the
 * Stitch "TableBells Guest Ordering" design where every screen carries an
 * `EN | عربي` switch.
 *
 * - `locale` drives both the static UI dictionary (`t(key)`) and how
 *   localized Firestore text (`{ en, ar }`) is picked (`pick(loc)`).
 * - `dir` flips to `rtl` for Arabic. It's written onto `<html dir lang>`
 *   so the whole guest tree (and native form controls) mirror; the guest
 *   layout also sets it on its wrapper for immediate paint.
 * - The choice persists in `localStorage` so a guest who switched once
 *   stays switched across the menu → cart → tracker navigation.
 *
 * Scope: guest surface only. The console/manager surfaces are English and
 * do not mount this.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LocalizedText } from '@/types/firestore';

export type GuestLocale = 'en' | 'ar';

const STORAGE_KEY = 'tb_guest_locale';

/** Static UI chrome. Keep keys stable — components reference them. */
const STRINGS: Record<string, LocalizedText> = {
  kitchen_live: { en: 'Kitchen Live & Ready', ar: 'المطبخ يعمل وجاهز' },
  kitchen_busy: { en: 'Kitchen Busy — longer waits', ar: 'المطبخ مشغول — انتظار أطول' },
  kitchen_closed: { en: 'Kitchen Closed', ar: 'المطبخ مغلق' },
  guest_wifi: { en: 'Guest Wi-Fi', ar: 'واي فاي الضيوف' },
  tap_to_copy_pw: { en: 'Tap to copy password', ar: 'اضغط لنسخ كلمة المرور' },
  no_password: { en: 'No password required', ar: 'لا حاجة لكلمة مرور' },
  wifi_copied: { en: 'Wi-Fi password copied', ar: 'تم نسخ كلمة مرور الواي فاي' },
  instant_service: { en: 'Instant Service Triggers', ar: 'طلبات خدمة فورية' },
  instant_notification: { en: 'Instant notification', ar: 'إشعار فوري' },
  call_waiter: { en: 'Call Waiter', ar: 'نداء النادل' },
  call_waiter_sub: { en: 'Avg 1m', ar: 'خلال دقيقة' },
  free_water: { en: 'Free Water', ar: 'مياه مجانية' },
  free_water_sub: { en: 'Still / Chilled', ar: 'عادية / مثلجة' },
  wipes_set: { en: 'Wipes & Set', ar: 'مناديل وأدوات' },
  wipes_set_sub: { en: 'Table gear', ar: 'مستلزمات الطاولة' },
  chefs_highlights: { en: "Chef's Highlights", ar: 'اختيارات الشيف' },
  dine_in_favorites: { en: 'Dine-in favorites', ar: 'الأكثر طلباً' },
  all: { en: 'All', ar: 'الكل' },
  incl_vat: { en: 'incl. VAT', ar: 'شامل الضريبة' },
  add: { en: 'Add', ar: 'أضف' },
  view_cart: { en: 'View Cart', ar: 'عرض السلة' },
  items: { en: 'items', ar: 'أصناف' },
  item: { en: 'item', ar: 'صنف' },
  ring_service_bell: { en: 'Ring Service Bell', ar: 'اقرع جرس الخدمة' },
  ring_bell_sub: { en: 'Tap anytime for instant assistance', ar: 'اضغط في أي وقت لمساعدة فورية' },
  request_sent: { en: 'Request sent — staff notified', ar: 'تم إرسال الطلب — تم إبلاغ الطاقم' },
  request_failed: { en: "Couldn't send that request. Try again.", ar: 'تعذّر إرسال الطلب. حاول مرة أخرى.' },
  direct_table_link: { en: 'Direct Digital Table Link', ar: 'رابط رقمي مباشر للطاولة' },
  service_guarantee: {
    en: 'Orders & assistance requests go straight to kitchen tablets and staff terminals. No registration required.',
    ar: 'تصل الطلبات وطلبات المساعدة مباشرة إلى أجهزة المطبخ والطاقم. لا حاجة للتسجيل.',
  },
  powered_by: { en: 'Powered by TableBells™ Hospitality Cloud', ar: 'مدعوم من TableBells™' },
  menu: { en: 'Menu', ar: 'القائمة' },
  my_bill: { en: 'My Bill', ar: 'فاتورتي' },
  service: { en: 'Service', ar: 'الخدمة' },
  loading_menu: { en: 'Loading the menu…', ar: 'جارٍ تحميل القائمة…' },
  menu_unavailable: { en: "The menu isn't available right now. Please try again shortly.", ar: 'القائمة غير متاحة حالياً. حاول بعد قليل.' },
  session_error: { en: "We couldn't verify your session. Please rescan the table QR code.", ar: 'تعذّر التحقق من جلستك. يرجى إعادة مسح رمز الطاولة.' },
  nothing_available: { en: 'Nothing is available on the menu right now.', ar: 'لا يوجد شيء متاح في القائمة حالياً.' },
  back: { en: 'Back', ar: 'رجوع' },
  checkout: { en: 'Checkout', ar: 'الدفع' },
  order_items: { en: 'Order Items', ar: 'أصناف الطلب' },
  freshly_prepared: { en: 'Freshly Prepared', ar: 'يُحضّر طازجاً' },
  each: { en: 'each', ar: 'للوحدة' },
  kitchen_notes: { en: 'Kitchen Notes & Allergies', ar: 'ملاحظات المطبخ والحساسية' },
  kitchen_notes_ph: { en: 'e.g. Extra hot milk, milk on the side, nut allergy…', ar: 'مثال: حليب ساخن جداً، الحليب جانباً، حساسية المكسرات…' },
  kitchen_notes_hint: { en: 'Our kitchen reads all custom table notes before preparing', ar: 'يقرأ المطبخ جميع الملاحظات قبل التحضير' },
  bill_summary: { en: 'Bill Summary', ar: 'ملخص الفاتورة' },
  tax_compliant: { en: 'UAE Tax Compliant', ar: 'متوافق مع ضريبة الإمارات' },
  items_subtotal: { en: 'Items Subtotal', ar: 'إجمالي الأصناف' },
  vat: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
  incl: { en: 'incl.', ar: 'شامل' },
  service_charge: { en: 'Service Charge', ar: 'رسوم الخدمة' },
  free: { en: 'Free', ar: 'مجاناً' },
  total_amount: { en: 'Total Amount', ar: 'المبلغ الإجمالي' },
  incl_all_taxes: { en: 'Inclusive of all local taxes', ar: 'شامل جميع الضرائب المحلية' },
  place_order: { en: 'Place Order', ar: 'إرسال الطلب' },
  sent_to_kds: { en: 'Sent directly to the Kitchen Display', ar: 'يُرسل مباشرة إلى شاشة المطبخ' },
  dine_in: { en: 'Dine-In', ar: 'داخل المطعم' },
  cart_empty: { en: 'Your cart is empty.', ar: 'سلتك فارغة.' },
  browse_menu: { en: 'Browse the menu', ar: 'تصفّح القائمة' },
  order_placed: { en: 'Order Placed!', ar: 'تم إرسال الطلب!' },
  confirmed_by_kitchen: { en: 'Confirmed by Kitchen', ar: 'مؤكد من المطبخ' },
  received_by_kitchen: { en: 'Received — awaiting kitchen', ar: 'تم الاستلام — بانتظار المطبخ' },
  est_serve_time: { en: 'Est. serve time', ar: 'وقت التقديم المتوقع' },
  on_track: { en: 'On track', ar: 'ضمن الوقت' },
  live_preparation: { en: 'Live Preparation', ar: 'التحضير المباشر' },
  live_updates: { en: 'Live updates', ar: 'تحديثات مباشرة' },
  order_received: { en: 'Order Received', ar: 'تم استلام الطلب' },
  sent_to_line: { en: 'Sent to the kitchen line', ar: 'أُرسل إلى خط المطبخ' },
  preparing_now: { en: 'Preparing Now', ar: 'قيد التحضير الآن' },
  in_progress: { en: 'In progress', ar: 'قيد التنفيذ' },
  preparing_sub: { en: 'The kitchen is crafting your order', ar: 'المطبخ يحضّر طلبك' },
  serving: { en: 'Serving', ar: 'التقديم' },
  serving_sub: { en: 'Brought directly to your table', ar: 'يُقدّم مباشرة إلى طاولتك' },
  order_summary: { en: 'Order Summary', ar: 'ملخص الطلب' },
  total_paid: { en: 'Total', ar: 'الإجمالي' },
  need_anything: { en: 'Need anything else?', ar: 'تحتاج أي شيء آخر؟' },
  tap_for_dispatch: { en: 'Tap for instant staff dispatch', ar: 'اضغط لإرسال الطاقم فوراً' },
  need_water: { en: 'Need Water', ar: 'أحتاج ماء' },
  extra_napkins: { en: 'Extra Napkins', ar: 'مناديل إضافية' },
  ask_question: { en: 'Ask Question', ar: 'اطرح سؤالاً' },
  call_server_to_table: { en: 'Call Server to Table', ar: 'استدعاء النادل للطاولة' },
  add_more_to: { en: 'Add More to', ar: 'أضف المزيد إلى' },
  add_more_hint: { en: 'Items are added to your open table tab.', ar: 'تُضاف الأصناف إلى فاتورة طاولتك المفتوحة.' },
  table: { en: 'Table', ar: 'طاولة' },
};

interface GuestLocaleContextValue {
  locale: GuestLocale;
  dir: 'ltr' | 'rtl';
  setLocale: (l: GuestLocale) => void;
  toggle: () => void;
  t: (key: keyof typeof STRINGS | string) => string;
  pick: (loc: LocalizedText | undefined | null) => string;
}

const GuestLocaleContext = createContext<GuestLocaleContextValue | null>(null);

export function GuestLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<GuestLocale>('en');

  // Restore the saved choice on mount (client only).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'ar' || saved === 'en') setLocaleState(saved);
    } catch {
      /* private mode / disabled storage — English default is fine */
    }
  }, []);

  const dir: 'ltr' | 'rtl' = locale === 'ar' ? 'rtl' : 'ltr';

  // Mirror onto <html> so native controls + scrollbars flip too.
  useEffect(() => {
    const root = document.documentElement;
    const prevDir = root.getAttribute('dir');
    const prevLang = root.getAttribute('lang');
    root.setAttribute('dir', dir);
    root.setAttribute('lang', locale);
    return () => {
      if (prevDir) root.setAttribute('dir', prevDir);
      else root.removeAttribute('dir');
      if (prevLang) root.setAttribute('lang', prevLang);
    };
  }, [dir, locale]);

  const setLocale = useCallback((l: GuestLocale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => setLocale(locale === 'en' ? 'ar' : 'en'), [locale, setLocale]);

  const value = useMemo<GuestLocaleContextValue>(
    () => ({
      locale,
      dir,
      setLocale,
      toggle,
      t: (key) => {
        const entry = STRINGS[key as string];
        return entry ? entry[locale] || entry.en : (key as string);
      },
      pick: (loc) => {
        if (!loc) return '';
        return (locale === 'ar' ? loc.ar : loc.en) || loc.en || loc.ar || '';
      },
    }),
    [locale, dir, setLocale, toggle],
  );

  return <GuestLocaleContext.Provider value={value}>{children}</GuestLocaleContext.Provider>;
}

export function useGuestLocale(): GuestLocaleContextValue {
  const ctx = useContext(GuestLocaleContext);
  if (!ctx) throw new Error('useGuestLocale() must be used within <GuestLocaleProvider>.');
  return ctx;
}
