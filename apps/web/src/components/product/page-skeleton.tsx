"use client";

import { useTranslations } from "next-intl";

import { Box, Card, CardContent, Grid, Skeleton, useMediaQuery } from "@mui/material";

/** The shapes a page of the logged area has, each drawn as it will be while it loads. */
export type PageShape = "list" | "record" | "home" | "board" | "cards" | "split" | "setup";

type Bone = { width?: number | string; height: number; round?: boolean };

/** One grey block of the drawing. */
function B({ width = "100%", height, round = false, still }: Bone & { still: boolean }) {
  return (
    <Skeleton
      variant={round ? "circular" : "rounded"}
      width={width}
      height={height}
      animation={still ? false : "pulse"}
      className="flex-none"
    />
  );
}

/**
 * The page that is loading, drawn in the shape it will have (the screen pattern after ADVBox, approved by the owner
 * on 2026-11-07): the title block, then the page's own form in grey blocks, in the very cards and spacing the page
 * uses, so nothing jumps when the content arrives and the person already sees where things will be. Never a
 * spinner in the middle of the screen, which said nothing of what was coming and covered the menu.
 *
 * `list`: the cards of numbers (`numbers` of them), the list's bar and its rows (`rows`, in one card or one card
 * each, `cards`); `record`: a record of many cards (a case), its top first and the cards in two columns; `home`: the
 * greeting with the modules, then what holds a case beside what to follow; `board`: the cards of numbers (`numbers`
 * of them), a board of columns by step under the parts of the way, then a card beside a wider one (the controladoria);
 * `split`: a list beside what is open of it (a conversation); `setup`:
 * the rail of steps beside the step; `cards`: a few cards one under the other, for any other page. The motion is a
 * slow pulse, and still for whoever asks the system for less motion. Said once to assistive technology as loading.
 */
export default function PageSkeleton({
  shape = "cards",
  numbers = 0,
  rows = 5,
  cards = false,
}: {
  shape?: PageShape;
  /** How many cards of numbers a list has above it. */
  numbers?: number;
  /** How many rows a list shows while it loads. */
  rows?: number;
  /** The rows of the list are cards of their own (publications, packages), not lines of one card. */
  cards?: boolean;
}) {
  const t = useTranslations("product");
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  const b = (bone: Bone) => <B {...bone} still={still} />;

  /** A card's head: the icon of what it is and its title. */
  const head = (width: number) => (
    <Box className="flex flex-row items-center gap-3">
      {b({ width: 36, height: 36 })}
      {b({ width, height: 20 })}
    </Box>
  );
  /** A line of a list: what it is, a quiet line under it, and its state on the right. */
  const line = (index: number) => (
    <Box key={index} className="border-grey-100 flex flex-row items-center gap-4 border-b py-3 last:border-b-0">
      <Box className="flex min-w-0 flex-1 flex-col gap-2">
        {b({ width: `${45 + ((index * 17) % 30)}%`, height: 16 })}
        {b({ width: `${60 + ((index * 11) % 25)}%`, height: 12 })}
      </Box>
      <Box className="hidden sm:block">{b({ width: 96, height: 24 })}</Box>
    </Box>
  );

  return (
    <Box className="flex flex-col gap-6" aria-busy="true">
      <span role="status" className="sr-only">
        {t("page-loading")}
      </span>

      {/* The title block: the page's title, its crumbs and the line of what it is for. */}
      <Box aria-hidden className="flex flex-col gap-2">
        {b({ width: "min(22rem, 70%)", height: 36 })}
        {b({ width: 120, height: 14 })}
        {b({ width: "min(40rem, 90%)", height: 14 })}
      </Box>

      <Box aria-hidden className="flex flex-col gap-6">
        {shape === "list" ? (
          <>
            {numbers > 0 ? (
              <Grid container spacing={2.5}>
                {Array.from({ length: numbers }, (_, index) => (
                  <Grid key={index} size={{ xs: 6, lg: "grow" }}>
                    <Card className="flex flex-col gap-2 px-4! py-3! sm:px-5! sm:py-4!">
                      <Box className="flex flex-row items-center gap-2.5">
                        <Box className="hidden sm:block">{b({ width: 32, height: 32 })}</Box>
                        {b({ width: "60%", height: 16 })}
                      </Box>
                      {b({ width: 56, height: 30 })}
                    </Card>
                  </Grid>
                ))}
              </Grid>
            ) : null}
            {/* The bar of every list: the ready views, the search, and what the list offers. */}
            <Card className="flex flex-row flex-wrap items-center gap-1.5 px-3! py-2.5!">
              {b({ width: 150, height: 36 })}
              {b({ width: "min(20rem, 100%)", height: 36 })}
              <Box className="hidden flex-row gap-1.5 sm:flex">
                {b({ width: 84, height: 36 })}
                {b({ width: 92, height: 36 })}
              </Box>
            </Card>
            {cards ? (
              Array.from({ length: Math.min(rows, 3) }, (_, index) => (
                <Card key={index}>
                  <CardContent className="flex flex-col gap-3">
                    {head(180 + ((index * 40) % 80))}
                    {b({ width: "70%", height: 14 })}
                    {b({ height: 56 })}
                    <Box className="flex flex-row gap-2">
                      {b({ width: 72, height: 32 })}
                      {b({ width: 88, height: 32 })}
                      {b({ width: 80, height: 32 })}
                    </Box>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card>
                <CardContent className="flex flex-col">
                  {Array.from({ length: rows }, (_, index) => line(index))}
                </CardContent>
              </Card>
            )}
          </>
        ) : null}

        {shape === "record" ? (
          <>
            {/* The top of the record: where it stands, its steps and what holds it. */}
            <Card>
              <CardContent className="flex flex-col gap-4">
                {head(200)}
                <Box className="flex flex-row gap-2">
                  {Array.from({ length: 5 }, (_, index) => (
                    <Box key={index} className="flex-1">
                      {b({ height: 8 })}
                    </Box>
                  ))}
                </Box>
                {b({ width: "80%", height: 14 })}
                {b({ width: "65%", height: 14 })}
              </CardContent>
            </Card>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, lg: 8 }} className="flex flex-col gap-3">
                {[220, 170, 240, 190].map((width, index) => (
                  <Card key={index}>
                    <CardContent className="flex flex-row items-center justify-between gap-3">
                      {head(width)}
                      {b({ width: 88, height: 24 })}
                    </CardContent>
                  </Card>
                ))}
              </Grid>
              <Grid size={{ xs: 12, lg: 4 }} className="flex flex-col gap-3">
                {[150, 180].map((width, index) => (
                  <Card key={index}>
                    <CardContent className="flex flex-col gap-3">
                      {head(width)}
                      {b({ width: "90%", height: 12 })}
                      {b({ width: "70%", height: 12 })}
                    </CardContent>
                  </Card>
                ))}
              </Grid>
            </Grid>
          </>
        ) : null}

        {shape === "home" ? (
          <>
            {/* The greeting with the modules, then what waits for the firm. */}
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8!">
                {b({ width: "min(24rem, 80%)", height: 32 })}
                {b({ width: "min(30rem, 90%)", height: 14 })}
                <Box className="flex flex-row flex-wrap justify-center gap-3 pt-3">
                  {Array.from({ length: 3 }, (_, index) => (
                    <Box key={index}>{b({ width: 120, height: 88 })}</Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
            {/* What holds a case in the wide column; what to follow and what ONE did this month in the side one. */}
            <Box className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card>
                <CardContent className="flex flex-col gap-4">
                  {head(220)}
                  <Box className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-3">
                    {[0, 1].map((index) => (
                      <Box key={index}>{b({ height: 92 })}</Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
              <Box className="flex flex-col gap-6">
                <Card>
                  <CardContent className="flex flex-col gap-4">
                    {head(150)}
                    {[0, 1, 2].map((index) => (
                      <Box key={index}>{b({ height: 56 })}</Box>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col gap-3">
                    {b({ width: "90%", height: 14 })}
                    {b({ width: "60%", height: 14 })}
                  </CardContent>
                </Card>
              </Box>
            </Box>
          </>
        ) : null}

        {shape === "board" ? (
          <>
            {numbers > 0 ? (
              <Grid container spacing={2.5}>
                {Array.from({ length: numbers }, (_, index) => (
                  <Grid key={index} size={{ xs: 6, lg: 3 }}>
                    <Card className="flex flex-col gap-2 px-4! py-3! sm:px-5! sm:py-4!">
                      <Box className="flex flex-row items-center gap-2.5">
                        <Box className="hidden sm:block">{b({ width: 32, height: 32 })}</Box>
                        {b({ width: "60%", height: 16 })}
                      </Box>
                      {b({ width: 56, height: 30 })}
                      {b({ width: "70%", height: 14 })}
                    </Card>
                  </Grid>
                ))}
              </Grid>
            ) : null}
            {/* The board: its title, the parts of the way, and its columns, each with its icon, name, number, button
                and first cases; as many as the page shows, the rest to the side. */}
            <Box className="flex flex-col gap-3">
              {b({ width: 160, height: 24 })}
              <Box className="flex flex-row gap-3 overflow-hidden">
                {Array.from({ length: 8 }, (_, index) => (
                  <Box key={index} className="flex w-60 flex-none flex-col gap-3 lg:w-52">
                    {b({ height: 32 })}
                    <Card className="flex flex-col items-center gap-2.5 px-4! py-5!">
                      {b({ width: 44, height: 44 })}
                      {b({ width: "60%", height: 16 })}
                      {b({ width: 64, height: 26 })}
                      {b({ height: 40 })}
                      {b({ height: 32 })}
                      {b({ height: 76 })}
                      {b({ height: 76 })}
                    </Card>
                  </Box>
                ))}
              </Box>
            </Box>
            {/* Who has the cases beside the court's numbers. */}
            <Box className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {[1, 2].map((span) => (
                <Card key={span} className={span === 2 ? "lg:col-span-2" : undefined}>
                  <CardContent className="flex flex-col gap-3">
                    {head(150)}
                    {[0, 1, 2, 3].map((index) => (
                      <Box key={index}>{b({ height: 56 })}</Box>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </Box>
          </>
        ) : null}

        {shape === "split" ? (
          <Grid container spacing={3}>
            {/* What can be opened, beside what is open of it. */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Card>
                <CardContent className="flex flex-col">
                  {Array.from({ length: 6 }, (_, index) => (
                    <Box key={index} className="flex flex-row items-center gap-3 py-2.5">
                      {b({ width: 40, height: 40, round: true })}
                      <Box className="flex min-w-0 flex-1 flex-col gap-2">
                        {b({ width: `${50 + ((index * 13) % 30)}%`, height: 14 })}
                        {b({ width: "80%", height: 12 })}
                      </Box>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 8 }} className="hidden md:block">
              <Card>
                <CardContent className="flex flex-col gap-4">
                  {head(180)}
                  {[60, 45, 70, 40].map((width, index) => (
                    <Box key={index} className={index % 2 ? "flex justify-end" : "flex justify-start"}>
                      {b({ width: `${width}%`, height: 48 })}
                    </Box>
                  ))}
                  {b({ height: 44 })}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        ) : null}

        {shape === "setup" ? (
          <Grid container spacing={3}>
            {/* The rail of the steps beside the step. */}
            <Grid size={{ xs: 12, md: 3 }} className="hidden md:block">
              <Box className="flex flex-col gap-4 pt-2">
                {Array.from({ length: 5 }, (_, index) => (
                  <Box key={index} className="flex flex-row items-center gap-3">
                    {b({ width: 28, height: 28, round: true })}
                    {b({ width: `${55 + ((index * 9) % 30)}%`, height: 14 })}
                  </Box>
                ))}
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 9 }}>
              <Card>
                <CardContent className="flex flex-col gap-4">
                  {head(220)}
                  {b({ width: "75%", height: 14 })}
                  {b({ height: 48 })}
                  {b({ height: 48 })}
                  <Box className="flex flex-row justify-end gap-2">{b({ width: 120, height: 40 })}</Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        ) : null}

        {shape === "cards"
          ? [190, 150, 210].map((width, index) => (
              <Card key={index}>
                <CardContent className="flex flex-col gap-3">
                  {head(width)}
                  {b({ width: "90%", height: 12 })}
                  {b({ width: "70%", height: 12 })}
                  {index === 0 ? b({ height: 44 }) : null}
                </CardContent>
              </Card>
            ))
          : null}
      </Box>
    </Box>
  );
}
