# IKKR Dynasty Wars

A mobile-first browser strategy game: conquer a world of rival kingdoms with heroes who lead squads that evolve as they survive battles.

**Play:** https://dianteclark.github.io/IKKR-DW/

- **World:** five sizes, from Small (24 lands) to Enormous (320 lands: two continents of 70+ lands, archipelagos joined by bridges and sea lanes). Hand-crafted-looking maps from every HAS biome: dense forests, mountain ranges along frontiers, rivers that rise in the mountains, roads between settlements, smooth realm borders, seasons on the map, a minimap and heroes walking the roads.
- **From village to empire:** most realms start as a one-land village with 3 heroes; a few great kingdoms start with 5. Settlements grow from huts to houses to walled towns to castles. Gather 5 heroes and your village becomes a kingdom.
- **The wilds:** about a third of the world starts free. Claim hamlets by force, plunder them, or protect them until they join you. Explore ruins, clear monster lairs and bandit camps, pray at shrines, claim mines, rest in groves, and court wanderers hiding in the wilds.
- **Seasons and dynasties:** each turn is a season. Heroes marry, children are born a year later, train in a parent's squad and come of age as heroes with a blend of their parents' strengths.
- **Realm management:** gold, food (harvests change with the season), morale and stability; taxes, rations, edicts; buildings including Stables (mounted troops ride two lands a season), Aerie (flyers cross the sea), Mage Tower, Beast Pit and Harbour (sea lanes).
- **Heroes and troops:** any troop your realm can raise, with race bonuses. Squads grow from 5 to about 45. Soldiers evolve into named Elites. At level 5 a hero picks a calling: Commander, Duelist, Strategist or Scout.
- **Living world:** quakes, wildfires, plague, floods, harvests, famine, bandits, monster outbreaks, raids from wild lairs, revolts and overthrows.
- **Diplomacy:** alliances (player-to-player too), vassals, coalitions, lending heroes, defection and battlefield treachery.
- **Battles:** real time from above. Orders are always obeyed; tap or drag to command, select all or box-select, see each route. Formations, stratagems, hero duels, collapsing roads and floods, sieges and island battles.
- **Saves:** every campaign has a campaign code and saves each season. Back up and import campaigns. Two-player campaigns are saved on both phones with private seat keys; either player can host the resume.
- **Two players:** peer-to-peer campaigns with room codes (PeerJS).

Built for phones in landscape. Plain JavaScript + canvas, no build step: open `index.html` through any static server.

## How to play
- **Campaign:** tap a land, then give each hero an order: Attack, Move, Rest (heal and recruit), Drill, Spy, or in the wilds Plunder, Protect, Explore a site or Court a wanderer. Develop towns, build, hire wanderers. End the turn when ready.
- **Battles:** tap a squad (or All, or Box and drag), then tap a base to march there or an enemy squad to attack it; or drag from a squad to where it should go. Change formation from the bar at the bottom. ★ appears on a hero when their special is charged. Attackers win by taking the main post; defenders win by routing the attackers or holding out until the timer ends.
- **Formations:** Wedge beats Line, Line beats Square, Square beats Wedge. Loose is fast and takes less damage from arrows.
- **Prisoners:** recruit, release (they wander, may join others or start an uprising) or execute.
- **Multiplayer:** one player taps Multiplayer → Host and shares the 5-letter code; the other enters it and taps Join. Both pick a people and 3 heroes. To resume, either player opens Continue → Host & resume; the other joins with the room code. Each player taps End Turn; the host's device runs the AI and the battles. Needs an internet connection (PeerJS broker).

## Project layout
- `js/game/` campaign rules, world generation, AI, items, save
- `js/battle/` battlefield generation and the real-time simulation
- `js/scenes/` title, setup, campaign, battle, multiplayer lobby
- `js/net/net.js` PeerJS link (host-authoritative)
- `tools/` scripts that read the sprite sheets and generate `js/data/*.js`

## Run locally
```
python3 -m http.server 8000
```
then open http://localhost:8000

## Credits
Art: **Aleksandr Makarov (IKnowKingRabbit)** — HAS asset packs. https://www.patreon.com/iknowkingrabbit
Fonts: Pixelify Sans and Silkscreen (SIL Open Font License), MiKroll Fantasy (HAS UI pack).
