"use client";

import { Box, Table, TableBody, TableCell, TableFooter, TableHead, TableRow, Typography } from "@mui/material";

import { cn } from "@/lib/utils";

/** One cell: the figure, an optional x-of-y under it, and a mark for a window that is still open. */
export type ComparisonCell = {
  primary: string;
  secondary?: string;
  /** A short mark after the figure ("†"), explained in the table's `legend`. */
  mark?: string;
};

export type ComparisonRow = {
  key: string;
  label: string;
  /** A short note under the row label ("fora da regra"). */
  note?: string;
  /**
   * Sets the row in the secondary text colour: it is shown for completeness
   * and is not part of the comparison. Never by opacity, which drops the
   * text below the contrast floor.
   */
  muted?: boolean;
  cells: ComparisonCell[];
};

/**
 * A few rows compared across a few columns where every cell is a figure: a
 * metric per segment and week, the leader of each metric per week. The job is
 * to read across and down at once, which is what a real `<table>` is for.
 *
 * Closest template section: the dense summary tables of the template's
 * analytics dashboards (Table size="small" inside a Card). Nothing in this
 * catalog fitted: DataTable is the shape for managing MANY rows (search,
 * paging, row actions), and a six-by-eight grid of numbers needs none of that,
 * while a MetricBars or a StatTile shows one population or one number, not a
 * grid. The first column stays in place while the weeks scroll sideways on a
 * phone, and the scroll region is reachable from the keyboard.
 */
export default function ComparisonTable({
  caption,
  rowHeader,
  columns,
  rows,
  footer,
  legend,
  className,
}: {
  /** What the table shows, for assistive technology (the card title is the visible one). */
  caption: string;
  /** The heading of the first column ("Segmento"). */
  rowHeader: string;
  columns: { key: string; label: string; note?: string; highlight?: boolean }[];
  rows: ComparisonRow[];
  /** A totals row, set apart from the body. */
  footer?: ComparisonRow;
  /** One line explaining the marks used in the cells. */
  legend?: string;
  className?: string;
}) {
  const renderRow = (row: ComparisonRow, isFooter = false) => (
    <TableRow key={row.key}>
      <TableCell
        component="th"
        scope="row"
        className={cn(
          "bg-background-paper sticky left-0 z-10 min-w-36 align-top",
          isFooter && "border-grey-100 border-t-2",
        )}
      >
        <Typography variant="subtitle2" component="span" className={cn("block", row.muted && "text-text-secondary")}>
          {row.label}
        </Typography>
        {row.note ? (
          <Typography variant="body2" component="span" className="text-text-secondary block">
            {row.note}
          </Typography>
        ) : null}
      </TableCell>
      {row.cells.map((cell, index) => (
        <TableCell
          key={columns[index]?.key ?? index}
          align="right"
          className={cn(
            "align-top whitespace-nowrap",
            columns[index]?.highlight && "bg-grey-25",
            isFooter && "border-grey-100 border-t-2",
          )}
        >
          <Typography
            variant="body1"
            component="span"
            className={cn("block tabular-nums", row.muted && "text-text-secondary")}
          >
            {cell.primary}
            {cell.mark ? <span className="text-text-secondary ml-0.5">{cell.mark}</span> : null}
          </Typography>
          {cell.secondary ? (
            <Typography variant="body2" component="span" className="text-text-secondary block tabular-nums">
              {cell.secondary}
            </Typography>
          ) : null}
        </TableCell>
      ))}
    </TableRow>
  );

  return (
    <Box className={cn("flex flex-col gap-2", className)}>
      <Box
        tabIndex={0}
        role="region"
        aria-label={caption}
        className="focus-visible:outline-primary overflow-x-auto rounded-2xl focus-visible:outline-2"
      >
        <Table size="small" className="min-w-max">
          <caption className="sr-only">{caption}</caption>
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col" className="bg-background-paper sticky left-0 z-10">
                <Typography variant="body2" component="span" className="text-text-secondary">
                  {rowHeader}
                </Typography>
              </TableCell>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  component="th"
                  scope="col"
                  align="right"
                  className={cn("whitespace-nowrap", column.highlight && "bg-grey-25")}
                >
                  <Typography variant="body2" component="span" className="text-text-secondary block">
                    {column.label}
                  </Typography>
                  {column.note ? (
                    <Typography variant="body2" component="span" className="text-text-secondary block">
                      {column.note}
                    </Typography>
                  ) : null}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>{rows.map((row) => renderRow(row))}</TableBody>
          {footer ? <TableFooter>{renderRow(footer, true)}</TableFooter> : null}
        </Table>
      </Box>
      {legend ? (
        <Typography variant="body2" className="text-text-secondary">
          {legend}
        </Typography>
      ) : null}
    </Box>
  );
}
