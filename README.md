# IKKR Dynasty Wars

A mobile-first browser strategy game: conquer a world of rival kingdoms with heroes who lead squads that evolve as they survive battles.

**Play:** https://dianteclark.github.io/IKKR-DW/

- **Campaign:** four world sizes (24 to 100 lands, including an island archipelago crossed by ship), every HAS biome, rivers, roads, farms and landmarks. Many kingdoms of 10 races, with several of the same race competing.
- **Realm management:** realm-wide gold, food, morale and stability. Set taxes and rations, issue one edict per turn, and grow from Village to Kingdom to Empire to unlock troop tiers, buildings (Training Pits, Spy Network, War Academy, Granaries, War Council) and stratagems.
- **Living world:** earthquakes, wildfires, plague, floods, harvests, gold strikes, famine, bandit tribes, monster outbreaks, civil uprisings, and revolutions that can overthrow a ruler.
- **Diplomacy:** alliances (player-to-player too), vassals who submit out of fear, coalitions against whoever dominates, and lending heroes to allies. Disloyal heroes may defect or secretly turn on you in battle.
- **Heroes and troops:** any troop type your realm can raise, with bonuses when a hero leads their own race or fights beside kin. Squads grow from 5 to about 40 as heroes level. Soldiers evolve from Recruit to Veteran to a named Elite, who can be raised to hero.
- **Battles:** real time, seen from above, on handcrafted-style battlefields (plains, river crossings, mountain passes, forests, lakes, coasts, ruins, walled sieges, dungeon halls). Formations counter each other and take time to change. Bring up to 3–4 stratagems per battle (Ambush, Fire Attack, Rockslide, Sow Discord…). Routes can flood, collapse or burn mid-battle. Before each battle you see the odds, which are exact only if you spied first.
- **Prisoners:** recruit, release or execute, with dialogue. You lose only when your last hero falls; a landless warband can rise up and take land again.
- **Two players:** peer-to-peer campaigns with room codes (PeerJS). Win alone or as an alliance, but only if you proposed most of your own alliances.
- **Sound:** generated retro sound effects and music.

Built for phones in landscape. Plain JavaScript + canvas, no build step: open `index.html` through any static server.

## How to play
- **Campaign:** tap your town, then give each hero an order: Attack a neighbour, Move, Rest (heal + morale), Drill (morale + troop XP) or Recruit (refill the squad with fresh stage-1 soldiers). Develop towns for more income. Hire wandering heroes found in your lands. End the turn when ready.
- **Battles:** tap a squad, then tap a post to march there or an enemy squad to attack it. Change formation from the bar at the bottom. ★ appears on a hero when their special is charged. Attackers win by taking the main post; defenders win by routing the attackers or holding out until the timer ends.
- **Formations:** Wedge beats Line, Line beats Square, Square beats Wedge. Loose is fast and takes less damage from arrows.
- **Prisoners:** recruit, release (they wander, may join others or start an uprising) or execute.
- **Multiplayer:** one player taps Multiplayer → Host and shares the 5-letter code; the other enters it and taps Join. Both pick a people and 2–3 heroes. Each player taps End Turn; the host's device runs the AI and the battles. Needs an internet connection (PeerJS broker).

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
