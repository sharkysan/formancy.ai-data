import { themeQuartz } from 'ag-grid-community'

/**
 * The grid in the room (0047, UX-SPEC §6.1): AG Grid Community's Quartz
 * theme, recoloured only through its parameters, each a variable of the
 * room's (@formancy/themes/room.css, the admin's palette, 0096) or an opaque mix of
 * parameters that are -- grid-theme.test.ts fails on anything else.
 *
 * - The well is the bench: `--ground`, opaque, as AG Grid requires.
 * - The header is a 4% mix of the text onto the ground, in `--muted`: the
 *   data carries the brightness.
 * - The open record is a 30% violet tint, and the shape that says "open" is
 *   the bar the first column's cell draws (grid-options.tsx), not the fill.
 * - The focused cell's border and a focused header's ring are teal, the
 *   room's focus; AG Grid draws the cell's from `rangeSelectionBorderColor`,
 *   which otherwise follows the accent.
 * - Rows are ruled in the quieter `--edge`; columns are not ruled.
 *
 * Sizes are AG Grid's pixels: 36px rows (the plugin's data-dense row), 14px
 * cells, a 13px header.
 */
export const ROOM_GRID = {
  backgroundColor: 'var(--ground)',
  foregroundColor: 'var(--text)',
  accentColor: 'var(--client)',
  borderColor: 'var(--edge-strong)',
  textColor: 'var(--text)',
  cellTextColor: 'var(--text)',
  subtleTextColor: 'var(--muted)',
  iconColor: 'var(--muted)',
  invalidColor: 'var(--invalid)',
  chromeBackgroundColor: { ref: 'foregroundColor', mix: 0.04, onto: 'backgroundColor' },
  headerBackgroundColor: { ref: 'foregroundColor', mix: 0.04, onto: 'backgroundColor' },
  headerTextColor: 'var(--muted)',
  headerCellHoverBackgroundColor: { ref: 'foregroundColor', mix: 0.08, onto: 'backgroundColor' },
  rowHoverColor: { ref: 'foregroundColor', mix: 0.06, onto: 'backgroundColor' },
  oddRowBackgroundColor: 'var(--ground)',
  selectedRowBackgroundColor: { ref: 'accentColor', mix: 0.3, onto: 'backgroundColor' },
  rangeSelectionBorderColor: 'var(--server)',
  focusShadow: { spread: 2, color: 'var(--server)' },
  fontFamily: 'var(--sans)',
  headerFontFamily: 'var(--sans)',
  fontSize: 14,
  dataFontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 600,
  spacing: 6,
  rowHeight: 36,
  headerHeight: 40,
  cellHorizontalPadding: 12,
  wrapperBorder: true,
  wrapperBorderRadius: 12,
  borderRadius: 8,
  rowBorder: { style: 'solid', width: 1, color: 'var(--edge)' },
  columnBorder: false,
  headerRowBorder: true,
  headerColumnBorder: false,
  browserColorScheme: 'dark',
} as const

/** The rows' height, said again as a grid option: a grid made inside a hidden view cannot measure its theme. */
export const ROW_HEIGHT = ROOM_GRID.rowHeight

export const roomGrid = themeQuartz.withParams(ROOM_GRID)
