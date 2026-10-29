/**
 * The robots that fetch a link to draw its preview in a messenger or a feed.
 * A robot names itself first (`WhatsApp/2.24 A`, `facebookexternalhit/1.1`)
 * or says `compatible;`; a browser, an app's own included, starts with
 * `Mozilla/` and says no such thing, so a person never lands on the notice a
 * page by token gives a robot in place of what the token opens.
 */
const PREVIEW_ROBOT_NAME =
  /WhatsApp|facebookexternalhit|Facebot|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|Googlebot|bingbot|Applebot|redditbot|Embedly|vkShare|Pinterest/i;

export const isPreviewRobot = (agent: string): boolean =>
  PREVIEW_ROBOT_NAME.test(agent) && (!agent.startsWith("Mozilla/") || agent.includes("compatible;"));
