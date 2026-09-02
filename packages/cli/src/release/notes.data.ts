/**
 * What changed, in product language, for the version this build *is*.
 *
 * Authored by hand and shipped inside the bundle, which is the whole point:
 * it answers offline, it always describes the version actually running, and it
 * never depends on GitHub being reachable. The generated CHANGELOG.md stays
 * where it belongs — the commit-level history a developer reads — and the
 * dialog links out to the release page for that full list.
 *
 * One entry per published version, newest first. `releaseNotes.test.ts` holds
 * the top entry to the version in package.json, so a release PR goes red until
 * a human has written this. That failure is the feature.
 */

export interface ReleaseSection {
  /** A product area, not a commit scope: "Create", "Scenes", "Fixes". */
  heading: string;
  /** One or two sentences. What it means for the work, not what the diff did. */
  body: string;
}

export interface ReleaseEntry {
  /** Exact semver, matching the published tag. */
  version: string;
  /** ISO yyyy-mm-dd. Rendered in the reader's locale. */
  date: string;
  /** Optional one-line headline above the sections. */
  title?: string;
  /**
   * Two to four. More than that is a changelog, and there is one of those
   * already.
   *
   * **Empty is legal and meaningful**: it says "this version changed nothing a
   * user would notice" — a maintenance release, a build fix, a dependency
   * bump. Every published version still gets a record, so a missing entry
   * always means someone forgot; an empty one always means there was nothing
   * to say. What's New stays shut for these: no dialog, no unread dot, and
   * opening it by hand names the version and links to the full changelog.
   */
  sections: ReleaseSection[];
  /**
   * Reserved. A release with a genuinely visual change may carry one supporting
   * image; nothing renders it yet, and it is never a carousel.
   */
  image?: string;
}

// 0.1.0 and 0.1.1 were published to npm and unpublished on 2026-08-17; those
// numbers are burned and their tags never existed (see packSurface.test.ts).
// They stay recorded here as the internal era. The first public
// release is 0.2.0.
export const RELEASES: ReleaseEntry[] = [
  {
    version: '0.8.0',
    date: '2026-09-02',
    title: 'The composer, rebuilt around what a shot is made of.',
    sections: [
      {
        heading: 'Create',
        body: 'Ingredients are compact chips now, each carrying the picture it stands for, and hovering one shows you what it is holding. A shot can hold twelve of them: the ones your engine can photograph are lit, and the rest ride along in words rather than being dropped, with every chip saying which it is. Photos go out in the order you wrote them, so the first thing you named is the first thing pictured. The asset panel beside the brief is a second door into it, so a tile ticks when its chip is in and clicking it again takes the chip out.',
      },
      {
        heading: 'Refine',
        body: 'The panel beside an open shot has been redrawn, and its edge can be dragged to the width you want. Above the brief it shows what the picture is actually made of, resolved through the whole chain of refinements rather than just the last one, so nothing is repeated and nothing is lost at depth.',
      },
      {
        heading: 'Brand',
        body: 'A product name is something to show in a shot, never lettering to paint into it, and a brand colour is now spoken as a note rather than an instruction, which keeps invented signage out of your pictures. Brand rules apply to every shot from Settings, so the composer no longer carries a row to say so.',
      },
      {
        heading: 'Fixes',
        body: 'A finished shot appears the moment it lands instead of waiting for the rest of its batch, and a batch sent from a set files every shot in it. Typing around a chip behaves: the chip owns the space beside it, one press removes it, and two chips always keep the single space between them. Two presenters in a scene no longer compose one of them out.',
      },
    ],
  },
  {
    version: '0.7.5',
    date: '2026-09-01',
    title: 'Every shot is one card.',
    sections: [
      {
        heading: 'Create',
        body: 'Every shot is now its own card with its own image. Asking for several shots gives you that many cards, made together and standing on their own, and older multi-image shots split into separate cards the first time this version opens. The shot panel is rebuilt around the brief itself, with inline ingredient chips and versions in a single strip under the picture.',
      },
      {
        heading: 'Refining',
        body: 'The shot being refined appears as a regular chip in the composer, and the card it points at is marked in the feed. Scenes sit out of the attach panel while a refine is armed, with a note saying why, instead of quietly trading the refine for a new shot.',
      },
      {
        heading: 'Fixes',
        body: 'Generation requests carry exactly the reference images they claim to carry, and a product or presenter whose photo is missing stops the shot with a clear message instead of running without it. Cards that are still rendering show a simple counter and a cancel button.',
      },
    ],
  },
  {
    version: '0.7.4',
    date: '2026-08-31',
    sections: [
      {
        heading: 'Fixes',
        body: 'A shot that Codex could not finish now says why it failed. Failures used to quote the banner Codex prints as it starts, which names the working folder and the model but never the reason. A Windows machine that cannot start the Codex tool host is now told which setting to change.',
      },
    ],
  },
  {
    version: '0.7.3',
    date: '2026-08-31',
    sections: [
      {
        heading: 'Fixes',
        body: 'A finished shot now reports done only after its delivered size is on record, so a tile can no longer guess its shape for a moment while the record catches up.',
      },
    ],
  },
  {
    version: '0.7.2',
    date: '2026-08-30',
    title: 'Changing a shot to a new shape keeps the photograph.',
    sections: [
      {
        heading: 'Create',
        body: 'Refining a shot into a different aspect ratio no longer costs it quality. The frame is planned at the size the engine can genuinely draw, so nothing is enlarged afterwards to fill a canvas its pixels could not reach. The presenter, the product, the wardrobe, the light and the subject scale carry across the new shape, and the stored size is now the size that was really drawn.',
      },
      {
        heading: 'Fixes',
        body: 'A target shape that is tighter than the shot now crops it, instantly and without a generation, instead of building out around it. A shape too far from the current one to reach in a single step crops as well, and says so, rather than attempting a stretch that could not work. The composer tells you which of the two will happen before you run it.',
      },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-08-30',
    title: 'Four images from one brief are one set.',
    sections: [
      {
        heading: 'Create',
        body: 'Asking for two, three or four images returns variations of one shot rather than four readings of it. The presenter, the product, the scene and the brand hold across the set, and so does the wardrobe. What changes is the photography: each frame explores a different camera position, crop or pose within the brief you wrote.',
      },
      {
        heading: 'Presenters',
        body: 'A selected presenter now reaches generation as a portrait, not only as full-length views, so their face carries into every image of a run instead of being rebuilt each time. Presenters built in Scenri gain a head-and-shoulders reference of their own, and their casting notes reach the shot.',
      },
      {
        heading: 'Fixes',
        body: 'A run that takes too long keeps the images that already finished instead of throwing them away with the rest. Refining a shot conditions on the same presenter portrait the generation used.',
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-08-30',
    title: 'Your presenter stays your presenter.',
    sections: [
      {
        heading: 'Scenes',
        body: 'A scene lends its world, its light and its treatment, never a face. Generation now conditions on the scene’s own drawn card instead of your raw upload, so the person you selected is the person in the shot. Scenes made before this release render printed treatments best after a one-tap redraw from the scene’s page.',
      },
      {
        heading: 'Refine',
        body: 'Refining light and mood no longer wears a shot down: a tonal refinement keeps the photograph’s own pixels and changes only the grade, so the tenth adjustment is as sharp as the first. High-resolution refinements state their working size honestly instead of inflating it, and refining an extended shot works again.',
      },
      {
        heading: 'Presenters',
        body: 'A presenter’s identity rides with three of their views. A reference you attach cannot lend anyone its face while a presenter is selected, and a mood image carried into a refinement is never mistaken for the person in the picture.',
      },
    ],
  },
  {
    version: '0.6.13',
    date: '2026-08-30',
    sections: [
      {
        heading: 'Products',
        body: 'A product sold in several colours renders the colour its first photo shows, instead of blending them. Imported products now carry their own description and colour list into every shot, so scale and colourway stay true.',
      },
      {
        heading: 'Brand',
        body: 'Attach your own logo straight from the Brand tab when composing; it joins the kit and rides the shot. Small logo files are raised to a workable resolution, the smallest lettering and its script are now part of the contract, and a logo too small to survive says so before you spend.',
      },
      {
        heading: 'Create',
        body: 'The refine strip counts each product once and names the scene a thread keeps. A retried shot carries your recipe, never leftovers from the previous run.',
      },
    ],
  },
  {
    version: '0.6.12',
    date: '2026-08-29',
    sections: [
      {
        heading: 'Create',
        body: 'Hovering a reference image in the brief shows what it is, and opening one shows it at a size you can read. The same holds for a brand mark, and for the references a refinement is carrying.',
      },
    ],
  },
  {
    version: '0.6.11',
    date: '2026-08-29',
    sections: [
      {
        heading: 'Create',
        body: "Hitting your Codex plan's usage limit now says so in plain words, with the time it comes back, instead of a technical session listing.",
      },
    ],
  },
  {
    version: '0.6.10',
    date: '2026-08-29',
    title: 'Pictures keep their shape.',
    sections: [
      {
        heading: 'Create',
        body: 'Images can no longer come back crushed or stretched: Scenri now works with the exact frame sizes the Codex image tool actually produces, and an answer that drifts off the requested shape is trimmed to it rather than distorted or refused. The wave of failed shots saying the engine could not produce the requested aspect ratio is gone with it, and refining an image over and over keeps its full sharpness at every step.',
      },
      {
        heading: 'Scenes',
        body: 'When a scene built from photographs of one person is used with a chosen presenter, every output now shows the chosen presenter. Each reference image travels with a name that says what it is, so a scene photograph can lend its world and its styling without lending anyone a face, and asking for several variations gives every variation the same instructions rather than letting the first one copy the reference.',
      },
    ],
  },
  {
    version: '0.6.9',
    date: '2026-08-29',
    title: 'Refinements keep the shot.',
    sections: [
      {
        heading: 'Refine',
        body: 'Refining a shot no longer wears it down. Every refinement keeps the original resolution, an answer that comes back too small is restored to the frame or refused rather than quietly shrinking the thread, and a plain refinement stays a plain refinement instead of silently rebuilding the frame when an engine drifted its shape. The product, the presenter, the brand mark and your references now travel down the whole chain, together with what must hold about each of them, so the tenth refinement knows the shot as well as the first.',
      },
      {
        heading: 'Presenters',
        body: 'People render with real photographed skin: natural texture and fine lines stay, and the waxy, over-retouched gloss goes. Light still behaves like light, so a hard flash can genuinely shine. Products hold their real-world size in the frame, and a held product sits in a real grip instead of floating beside the hand. Asking for something surreal still wins.',
      },
      {
        heading: 'Create',
        body: 'Starting a fresh shot always starts fresh: a refinement you left open days ago can no longer greet you as the thing you are about to make. Refining any older shot still works exactly as before, whenever you come back to it. Around the chips, text selects, double-clicks and keyboard selection behave like any editor, and clicking a chip while text is selected opens its picker.',
      },
    ],
  },
  {
    version: '0.6.8',
    date: '2026-08-29',
    sections: [
      {
        heading: 'Create dialogs',
        body: 'A new product, presenter or scene starts from an empty form, every time. Closing one now ends it rather than keeping what you typed for later, so nothing you walked away from can turn up in the next one, and the message that says so offers Undo if you did not mean to close it. A build that fails still hands everything back, photographs included, so trying again never asks for them twice. A reference you remove stays removed, even when another upload was still running, and a scene that was built while the app was restarting no longer leaves its references waiting in the next form.',
      },
      {
        heading: 'Create',
        body: 'Selecting text in the brief with the mouse holds, instead of clearing the moment you let go.',
      },
    ],
  },
  {
    version: '0.6.7',
    date: '2026-08-29',
    sections: [
      {
        heading: 'Create',
        body: 'The brief starts empty. A scene you never picked could turn up in it, come back on every later load, and reappear after you removed it and reloaded. Create an image no longer stands a scene in for one you have not shortlisted, and a scene that arrives from a link is spent once it lands rather than waiting in the address to be applied again. Briefs you were part way through writing still come back as they always have.',
      },
    ],
  },
  {
    version: '0.6.6',
    date: '2026-08-29',
    sections: [
      {
        heading: 'Create',
        body: 'Removing a chip from the brief now works on the first click, every time, including right after dragging chips around. Codex generations no longer fail as timeouts while they are still working, and when a run does fail, the message says what actually happened instead of suggesting a second try.',
      },
      {
        heading: 'Presenters',
        body: 'Custom presenter avatars are cropped like real profile photos, head and shoulders from the front reference. Presenters you made earlier are reframed automatically, including ones that never got an avatar at all.',
      },
    ],
  },
  {
    version: '0.6.5',
    date: '2026-08-29',
    sections: [
      {
        heading: 'Scenes',
        body: 'A Scene no longer brings its own demo object into your shots. The product and presenter you select take the place of whatever its reference or preview happened to stage, while the environment, the light and any figure treatment carry over as before. Editing the Direction and pressing Read again now applies the Direction you wrote instead of quietly ignoring it.',
      },
    ],
  },
  {
    version: '0.6.4',
    date: '2026-08-29',
    sections: [
      {
        heading: 'Create',
        body: 'Adding a product, presenter or scene starts from an empty form. Photos and words belonging to something you already made no longer turn up in a new one, in a second tab, or after a restart. Closing the dialog still keeps what you were working on until you leave, and a build that fails still hands it all back so you can pick up where you were.',
      },
    ],
  },
  {
    version: '0.6.3',
    date: '2026-08-28',
    title: 'Your logo stays your logo, and every page opens like a page.',
    sections: [
      {
        heading: 'Brand',
        body: 'A brand mark attached to a shot is carried faithfully everywhere the shot goes: a refinement keeps it, Reuse setup rebuilds the brief with it, and when the logo has since left the kit, Scenri says so instead of quietly dropping it. The kit holds one primary logo at a time, every screen agrees which one it is, and the composer says before sending when an engine cannot carry the mark as an image.',
      },
      {
        heading: 'Fixes',
        body: 'Anything that opens a page is a real link now. Middle click, Cmd or Ctrl click and copy link work on the navigation, cards, shots, crumbs and notifications, each opening in its own tab, while a plain click stays as fast as before.',
      },
    ],
  },
  {
    version: '0.6.2',
    date: '2026-08-28',
    title: 'Scenes keep what makes them distinctive.',
    sections: [
      {
        heading: 'Scenes',
        body: 'A scene built from references that are about a person now keeps that person as part of its art direction: where they sit in the composition, and what has been done to them, whether that is a face covered in stickers or a figure behind fabric. Before, a reference like that was read as an empty room and the idea was lost.',
      },
      {
        heading: 'Create',
        body: 'Attach a presenter to a scene like that and they take the role, wearing their own face under the treatment. Attach nobody and the person stays anonymous. Ask for no people and the treatment stays on whatever is left in the frame.',
      },
      {
        heading: 'Building a scene',
        body: 'The notes field is now Direction, and it decides how your references are read. Say what matters in them and what to ignore, and it carries more weight than the pictures alone. You can edit it later from the scene page.',
      },
      {
        heading: 'Fixes',
        body: "Reading a scene's references again no longer clears the direction you wrote. Scenes you build yourself now appear on the home shelf beside the built-in ones, and a scene that finishes while you are looking at the library no longer stays hidden until you reload.",
      },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-08-26',
    sections: [
      {
        heading: 'Shots',
        body: "Refining a shot now opens at that picture's own shape. The aspect ratio belongs to the shot in front of you rather than to the last one you touched, so refining a portrait shot no longer quietly reframes it to whatever shape a different shot was set to, and two shots open side by side can each hold their own.",
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-08-26',
    sections: [
      {
        heading: 'Shots',
        body: 'Changing a shot to a wider or taller shape now keeps the original photograph wherever that can be done without a visible join, and rebuilds the frame as one coherent picture where it cannot. Scenri draws the new frame two ways, looks at both joins, and keeps the one you cannot find.',
      },
      {
        heading: 'Fixes',
        body: 'A refinement carrying a full set of product and presenter references now reaches the engine with the shot itself attached. Codex reads five pictures at most, and a sixth was quietly displacing the frame being refined.',
      },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-08-26',
    sections: [
      {
        heading: 'Shots',
        body: 'An extended shot keeps its subject where it was composed, so a product standing near one edge stays near that edge in the wider frame rather than drifting to the middle. The new margin now meets the picture across the whole join instead of only at the seam, so a difference in tone or light no longer survives out at the frame edge. Where a connected engine can paint a margin directly, an extension is handed to it.',
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-08-26',
    title: 'A finished shot can change shape, and a presenter you attach is a requirement rather than a suggestion.',
    sections: [
      {
        heading: 'Create',
        body: "A brief can be rearranged by hand: drag its chips into a new order, or move them with the keyboard and on touch. Chips now sit on the sentence's own baseline, so a brief reads as a line of writing rather than a row of boxes.",
      },
      {
        heading: 'Shots',
        body: 'Pick a new shape for a finished shot and Scenri works out from the geometry whether that means cropping or extending. A crop keeps every original pixel, follows the subject, costs nothing and calls no engine. An extension leaves the original untouched to the byte and paints only the new margin, and it is offered by the engines that can genuinely paint one.',
      },
      {
        heading: 'Presenters',
        body: 'A presenter you attach now survives what used to drop them from the picture: product notes written for a solo packshot, close-up framing, and scene direction that bans props. A custom presenter is cropped for their avatar the way the built-in ones are, measured from the person rather than from the frame.',
      },
      {
        heading: 'Fixes',
        body: 'What a shot says it used is what the engine received, including references and brand marks carried into a refine. Two shots sent in the same second keep their order, the newest shot is always top left, and text in right-to-left languages renders and travels correctly through the app.',
      },
    ],
  },
  {
    version: '0.4.7',
    date: '2026-08-24',
    title: 'The feed shows the work, and the controls wait until you point at it.',
    sections: [
      {
        heading: 'Create',
        body: "A shot tile is its picture until you point at it. A kept shot and a run holding several takes still say so with small marks, and a shot's actions arrive together on hover, reading the same over a dark photograph or a bright one.",
      },
      {
        heading: 'Shots',
        body: "Where a shot came from, how many versions it has and which sets it is filed in have moved into the shot's own record, which has the room to name those sets rather than count them.",
      },
      {
        heading: 'Fixes',
        body: 'Choosing shots for a set is steadier: a tap on the picture adds or removes it, and actions that only make sense for a single shot step aside while you choose. The feed no longer marks a shot nobody picked, clicking empty space clears a selection, and the selection checkbox stops flashing twice under a thumb.',
      },
    ],
  },
  {
    version: '0.4.6',
    date: '2026-08-24',
    sections: [
      {
        heading: 'Refining',
        body: 'Removing something from a shot no longer leaves a faint outline of it behind. The removed object is gone and the surface continues as if it had never been there.',
      },
      {
        heading: 'Shots',
        body: 'A finished shot now says how long it took to generate, next to what it cost. Feed tiles hold the exact shape of the picture they carry, so a landing image no longer shifts its column, and a garment shot with no presenter attached leans toward a proper product display rather than inventing someone to wear it.',
      },
    ],
  },
  {
    version: '0.4.5',
    date: '2026-08-23',
    title: 'New versions find you while Scenri runs.',
    sections: [
      {
        heading: 'Updates',
        body: 'A running Scenri now checks for new versions every six hours instead of relying on the next launch, and a laptop that slept through a check catches up within minutes of waking. Open tabs hear about a downloaded update within the half hour, or the moment you return to them.',
      },
      {
        heading: 'Fixes',
        body: 'Running from a source checkout no longer shows a floating update notice whose button had nothing to do. The checkout keeps its quiet badge and the pull-and-rebuild note in Settings.',
      },
    ],
  },
  {
    version: '0.4.4',
    date: '2026-08-23',
    title: 'Codex setup tells the truth, and a stuck generation fails instead of running forever.',
    sections: [
      {
        heading: 'Codex',
        body: 'Setup now verifies more than a binary on the path: it checks the version, the sign-in, and says "could not verify" when it cannot tell, with a Check again button instead of a false Connected. Windows instructions say PowerShell, and Codex installed through npm works again.',
      },
      {
        heading: 'Fixes',
        body: 'A generation that goes silent now fails within minutes with a plain reason instead of running on with no news, and Cancel stops the Codex process for real, on Windows too. A signed-out or outdated Codex fails fast with the step that fixes it.',
      },
    ],
  },
  {
    version: '0.4.3',
    date: '2026-08-23',
    title: 'Controls hold still when you press them.',
    sections: [
      {
        heading: 'Fixes',
        body: 'Pressing a button, chip or icon button no longer nudges it down. Controls answer with a change of fill or opacity instead, so nothing shifts under the cursor, and selected rows in Settings no longer re-space their labels when you pick them.',
      },
    ],
  },
  {
    version: '0.4.2',
    date: '2026-08-23',
    sections: [
      {
        heading: 'Updates',
        body: 'Settings now tells the update story in one row: what you are on, what arrived, and a single Update button for whichever step remains. The floating notice carries a small gift where the dot was.',
      },
    ],
  },
  {
    version: '0.4.1',
    date: '2026-08-23',
    title: 'Updates now arrive by themselves.',
    sections: [
      {
        heading: 'Updates',
        body: 'A new version now downloads quietly in the background, verifies itself next to the running copy, and asks for a single click to restart. This is also the release that makes in-app updating truly work on macOS and Linux, where the one-click path silently never engaged. Checking by hand always answers, even when automatic checks are off, and a restart never interrupts running work.',
      },
      {
        heading: 'Existing installs',
        body: 'Copies first started with npx before this release cannot pick the fix up on their own. Run npx scenri@latest once in a terminal; every update after that arrives without it.',
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-08-23',
    title: 'Refining a shot keeps the shot.',
    sections: [
      {
        heading: 'Refining',
        body: 'Asking for one change now makes one change. Adding a prop or removing an object keeps the rest of the photograph exactly as it was, down to the pixel, instead of returning a fresh interpretation of the same idea. A refinement also carries the product and the presenter it started from, so identity holds through a thread of edits, and a request that genuinely affects the whole frame, like new lighting or a different time of day, is still free to change it.',
      },
      {
        heading: 'Expand',
        body: 'A finished shot can be grown into another shape. Choosing a new aspect ratio while refining extends the picture you have and generates only the new margin, so the original is kept at its own resolution rather than being replaced by a different take. Nothing is ever cropped to fit.',
      },
      {
        heading: 'Presenters',
        body: 'The plain studio layers a presenter is photographed in no longer turn up as the outfit in a finished shot. Where the direction names no wardrobe, they are dressed for the place and the occasion in the frame.',
      },
      {
        heading: 'Fixes',
        body: 'The row of takes under a shot no longer stretches portrait and landscape images into squares. A shot card states what it is in one row, so set names no longer print over the version count and the Refine button, and the keeper star can now be used to keep a shot rather than only to un-keep one. Photos uploaded from a phone are stored the right way up. A run that loses one variant keeps the others instead of throwing all of them away, and the resolution setting no longer promises pixel counts on an engine that renders at its own size.',
      },
    ],
  },
  {
    version: '0.3.5',
    date: '2026-08-21',
    sections: [
      {
        heading: 'Fixes',
        body: 'Setting up the Codex engine on Windows no longer reports a successful install as missing, and updates can now find npm there. When npm truly is unreachable, the update command points to the one-line recovery instead of a dead end.',
      },
    ],
  },
  {
    version: '0.3.4',
    date: '2026-08-21',
    sections: [
      {
        heading: 'Presenters',
        body: "A presenter's reference photos now define who they are, not what they wear. The neutral studio outfit from their reference set no longer follows them into finished shots; wardrobe comes from the shot, the product and the scene instead, and refining an image keeps the outfit it already has.",
      },
      {
        heading: 'Fixes',
        body: 'Opening a presenter or scene you built yourself no longer freezes the app.',
      },
    ],
  },
  {
    version: '0.3.3',
    date: '2026-08-20',
    // Documentation only: the links on the npm package page were resolving
    // against the package folder and 404ing. Nothing inside the app changed.
    sections: [],
  },
  {
    version: '0.3.2',
    date: '2026-08-20',
    sections: [
      {
        heading: 'Fixes',
        body: 'When your computer refuses the Codex CLI install, setup now offers the command that gets past it instead of repeating the one that just failed. And once a step has succeeded, an old error clears instead of lingering under the green check.',
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-08-20',
    sections: [
      {
        heading: 'Fixes',
        body: 'Starting Scenri is calmer when something is wrong. A busy port or a failed start now explains itself in plain words instead of a stack trace, and the terminal says to keep its window open while Scenri runs.',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-08-20',
    title: 'The name is Scenri.',
    sections: [
      {
        heading: 'The name',
        body: 'Written out, the product is Scenri. Every screen, every page of the documentation and every line the terminal prints now spells it that way. Lowercase stays where a machine reads it: the command you type, the folder your library lives in, and the settings that configure it are all unchanged.',
      },
      {
        heading: 'Browser tabs',
        body: "A tab now names what is open in it rather than the section it came from, so eight products in eight tabs read as eight product names. Settings and What's new say so, an open shot says Shot, and a tab whose page is still loading names its section instead of going blank.",
      },
    ],
  },
  {
    version: '0.2.3',
    date: '2026-08-20',
    sections: [
      {
        heading: 'Security',
        body: 'The last advisory against a build dependency is closed. Nothing about how scenri runs changes, and nothing in the published package moves.',
      },
    ],
  },
  {
    version: '0.2.2',
    date: '2026-08-20',
    sections: [
      {
        heading: 'Security',
        body: 'Two dependencies are on their patched releases. The file server that serves the studio is updated for a path traversal advisory, and the image library scenri re-encodes every upload through is updated for the libvips advisories. Nothing about how scenri works changes.',
      },
    ],
  },
  {
    version: '0.2.1',
    date: '2026-08-20',
    sections: [
      {
        heading: 'Fixes',
        body: 'The mark that shipped in 0.2.0 was the wrong cut. The top bar, the app icons, and the readme now carry the real one.',
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-08-20',
    title: 'scenri goes public.',
    sections: [
      {
        heading: 'Compose',
        body: 'Type $ for a product, @ for a presenter and / for a scene, straight in the brief. The menu filters as you type and drops the pick in as a chip, so a whole shot can be assembled without leaving the keyboard. Enter no longer fires a shot while you are still placing one.',
      },
      {
        heading: 'A lighter install',
        body: 'The install dropped to about 12 MB. Every scene, presenter and recipe is still browsable immediately; the heavy imagery downloads once in the background, is cached locally forever, and SCENRI_NO_CONTENT_FETCH=1 turns the download off.',
      },
      {
        heading: 'Create dialogs',
        body: 'Creating a product, presenter or scene got fuller forms, and on a phone the dialogs open as sheets you can drag closed.',
      },
      {
        heading: 'The studio',
        body: 'The scenri mark sits in the top bar, the browser tab names the screen you are on, and About says who builds this and under which license.',
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-08-16',
    sections: [
      {
        heading: 'Fixes',
        body: 'Opening a shot from a notification could say it was no longer available, and renaming a set could drop you back to the feed. Both now check with the server before deciding something has gone.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08-16',
    title: 'The first complete scenri, released internally.',
    sections: [
      {
        heading: 'Create',
        body: 'Compose a shot from your products, presenters and scenes, then branch any result to art-direct it further. Every shot keeps the recipe that made it.',
      },
      {
        heading: 'Library',
        body: 'Products, Presenters and Scenes share one tool: the same filtering, the same grid, the same keyboard.',
      },
      {
        heading: 'Brand',
        body: 'Define a client once in Settings, then apply it to any shot with a chip. Nothing about a brand is ever applied behind your back.',
      },
      {
        heading: 'Updates',
        body: 'scenri updates itself in place. It downloads the new version beside the running one, proves it loads, then restarts into it. Your library is never part of that.',
      },
    ],
  },
];

/** The entry describing an exact version, or null when none was authored. */
export function releaseFor(version: string): ReleaseEntry | null {
  return RELEASES.find((r) => r.version === version) ?? null;
}

/**
 * Whether a release has anything to tell a user about. The one question that
 * decides if What's New may interrupt: a record with no sections is a release
 * that happened, not news.
 */
export function isNewsworthy(entry: ReleaseEntry | null): boolean {
  return (entry?.sections.length ?? 0) > 0;
}

/** Words that mean someone started selling rather than telling. */
const HYPE = /\b(revolutionary|game.?chang|supercharg|unlock the power|thrilled|seamlessly|effortlessly|delight)/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/**
 * Everything obviously broken about a set of release records, as plain
 * sentences. Empty means publishable.
 *
 * Deliberately not a validation framework: it exists to stop a version
 * shipping with no record, with someone else's record, or with copy that
 * breaks the house style (DESIGN.md §6, "Writing"). `releaseNotes.test.ts` runs it against the real
 * data, which is what makes the release PR go red until the notes are written.
 */
export function validateReleases(releases: ReleaseEntry[], currentVersion: string): string[] {
  const problems: string[] = [];
  const semver = /^\d+\.\d+\.\d+$/;

  if (releases.length === 0) return ['there are no release records at all'];

  // 0.0.0 is the pre-release placeholder release-please has not touched yet.
  if (currentVersion !== '0.0.0' && releases[0].version !== currentVersion) {
    problems.push(
      `the newest record is ${releases[0].version} but this build is ${currentVersion}; write the record for ${currentVersion}`,
    );
  }

  const seen = new Set<string>();
  let previous: number[] | null = null;
  for (const r of releases) {
    const where = `release ${r.version}`;
    if (!semver.test(r.version)) problems.push(`${where}: not a plain semver version`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push(`${where}: date is not yyyy-mm-dd`);
    if (seen.has(r.version)) problems.push(`${where}: described twice`);
    seen.add(r.version);

    const triplet = r.version.split('.').map(Number);
    if (previous && semver.test(r.version)) {
      const descending =
        previous[0] > triplet[0] ||
        (previous[0] === triplet[0] && previous[1] > triplet[1]) ||
        (previous[0] === triplet[0] && previous[1] === triplet[1] && previous[2] > triplet[2]);
      if (!descending) problems.push(`${where}: out of order; records run newest first`);
    }
    previous = triplet;

    if (r.title !== undefined && r.title.trim() === '') problems.push(`${where}: empty title`);
    // An empty sections array is legal: it is how a maintenance release says
    // "no news". A section that exists and says nothing is not.
    if (r.sections.length > 4) problems.push(`${where}: ${r.sections.length} sections; four is the ceiling`);
    for (const s of r.sections) {
      if (s.heading.trim() === '') problems.push(`${where}: a section with no heading`);
      if (s.body.trim() === '') problems.push(`${where}: section "${s.heading}" says nothing`);
    }

    const prose = [r.title ?? '', ...r.sections.flatMap((s) => [s.heading, s.body])].join(' ');
    if (HYPE.test(prose)) problems.push(`${where}: hype copy; say what changed, not how amazing it is`);
    if (EMOJI.test(prose)) problems.push(`${where}: emoji`);
    if (prose.includes('\u2014') || prose.includes('\u2013')) problems.push(`${where}: long dash`);
  }

  return problems;
}
