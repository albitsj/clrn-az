import { LOCALES, VISUAL_DEVICE_ID, type LocaleCode, type LocaleDef, type PageDef,
  type ViewportDef, type VisualScenario } from './scenarioTypes';

/**
 * 解析语言筛选配置，拒绝不支持的语言代码。
 * @param raw - 原始语言筛选配置。
 */
function parseLocaleFilter(raw: string | undefined): LocaleCode[] | 'all' {
  const value = (raw || 'zh-Hans').trim();
  if (['', 'all'].includes(value)) {
    return 'all';
  }

  return selectedLocales(value, raw);
}

/** Parse explicit locale values and retain the existing empty-selection error.
 * @param value - Trimmed selection.
 * @param raw - Original input for diagnostics.
 */
function selectedLocales(value: string, raw: string | undefined): LocaleCode[] {
  const allowed = new Set(LOCALES.map((locale) => locale.code));
  const selected = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is LocaleCode => allowed.has(item as LocaleCode));

  if (selected.length === 0) {
    throw new Error(
      `VISUAL_LOCALES 无效: "${raw}"。可用值: ${LOCALES.map((l) => l.code).join(', ')}, all`,
    );
  }

  return selected;
}

/**
 * 根据环境配置选出本轮使用的语言，支持全量语言模式。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getActiveLocales(env: NodeJS.ProcessEnv = process.env): LocaleDef[] {
  const filter = parseLocaleFilter(env.VISUAL_LOCALES);
  if (filter === 'all') {
    return LOCALES;
  }
  return LOCALES.filter((locale) => filter.includes(locale.code));
}

/**
 * 场景 label：`{locale}_{viewport}_{page}`，便于在目录与 HTML 报告中按「语言 → 视口」分组。
 * 例：`zh-Hans_desktop_hall`、`zh-Hans_mobile_signed_in_me`
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。
 * @param pageLabel - 页面定义中的场景标签。
 * @param suffix - 需要追加到场景标签的可选后缀。
 */
export function scenarioLabel(
  locale: LocaleDef,
  viewport: ViewportDef,
  pageLabel: string,
  suffix = '',
): string {
  const base = `${locale.code}_${viewport.label}_${pageLabel}`;
  return suffix ? `${base}_${suffix}` : base;
}

/**
 * 合并页面、语言、视口与覆盖选项，生成一个完整视觉场景。
 * @param page - 待展开的页面定义。
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。
 * @param overrides - 覆盖页面默认设置的场景选项。
 */
export function buildScenario(
  page: PageDef,
  locale: LocaleDef,
  viewport: ViewportDef,
  overrides: Partial<VisualScenario> & { label?: string; pageLabel?: string } = {},
): VisualScenario {
  return {
    label: scenarioLabel(locale, viewport, page.label),
    group: 'hall',
    path: page.path,
    pageLabel: page.label,
    locale: locale.code,
    viewport,
    readyText: page.readyText?.[locale.code],
    visualReadySelector: page.visualReadySelector,
    signIn: false,
    deviceId: VISUAL_DEVICE_ID,
    tabTestId: '',
    navClickTestIds: [],
    waitForLoading: true,
    fixedTexts: [],
    hideSelectors: [],
    ...overrides,
  };
}

