// Given names by people and gender, so a son is never called Cassia.
export const GIVEN = {
  castle: {
    m: ['Roland', 'Gareth', 'Alaric', 'Oswin', 'Cedric', 'Edmund', 'Tristan', 'Percival', 'Godfrey', 'Aldric', 'Bertram', 'Leofric', 'Osric', 'Wendel', 'Hugo', 'Corwin'],
    f: ['Isolde', 'Rowena', 'Sabine', 'Elaine', 'Gwendolyn', 'Matilda', 'Rosalind', 'Beatrix', 'Adela', 'Cecily', 'Odette', 'Evelyn', 'Linnea', 'Maude', 'Seraphine', 'Ysolde'],
  },
  rampart: {
    m: ['Thalion', 'Eldrin', 'Faelar', 'Caladir', 'Aerendil', 'Lorien', 'Sylvar', 'Ithil', 'Galen', 'Orophin', 'Varis', 'Elros', 'Thrandor', 'Celeborn', 'Arannis', 'Haldir'],
    f: ['Sylvara', 'Elowen', 'Aerith', 'Nimue', 'Lirael', 'Faewyn', 'Ilyana', 'Melian', 'Tauriel', 'Arwen', 'Elara', 'Nessa', 'Yavanna', 'Liriel', 'Saelith', 'Thessaly'],
  },
  tower: {
    m: ['Solon', 'Theron', 'Cassius', 'Damian', 'Lucan', 'Orion', 'Ptolem', 'Zephyrin', 'Alastor', 'Corvin', 'Magnus', 'Erasmus', 'Septimus', 'Halvard', 'Icarus', 'Quill'],
    f: ['Astra', 'Cassia', 'Lyra', 'Minerva', 'Selene', 'Thalia', 'Celeste', 'Aurora', 'Vespera', 'Ione', 'Calliope', 'Hypatia', 'Nova', 'Ophira', 'Delphine', 'Zora'],
  },
  inferno: {
    m: ['Belzar', 'Malgorath', 'Azgar', 'Vorgath', 'Ignatius', 'Kazrak', 'Draxus', 'Morbael', 'Scorch', 'Baalok', 'Infernus', 'Xarth', 'Ghaz', 'Molok', 'Vexor', 'Sulfrak'],
    f: ['Nadira', 'Pyrrha', 'Lilith', 'Ashara', 'Zephira', 'Morrigan', 'Seraxa', 'Ember', 'Vashti', 'Ignis', 'Cindra', 'Malice', 'Nyx', 'Sarra', 'Kalyx', 'Brimra'],
  },
  necropolis: {
    m: ['Mortis', 'Vlad', 'Corvus', 'Draven', 'Malachar', 'Sepulcher', 'Thanos', 'Grimwald', 'Lucius', 'Mordecai', 'Nathrak', 'Osric', 'Vardak', 'Kael', 'Zarek', 'Ulric'],
    f: ['Mirelle', 'Sable', 'Morwen', 'Lenore', 'Ravena', 'Ophelia', 'Carmilla', 'Nerissa', 'Vespera', 'Lamia', 'Hecate', 'Isadora', 'Selka', 'Umbra', 'Valeska', 'Wraith'],
  },
  stronghold: {
    m: ['Gorak', 'Thrak', 'Brug', 'Krull', 'Mog', 'Grosh', 'Durk', 'Zug', 'Rakka', 'Ugluk', 'Borg', 'Grom', 'Snag', 'Varg', 'Hruk', 'Tusk'],
    f: ['Murga', 'Shagra', 'Grizza', 'Yazga', 'Bolga', 'Urza', 'Ragna', 'Skarra', 'Druga', 'Hilga', 'Vrenna', 'Kasha', 'Ozga', 'Thura', 'Nogra', 'Brakka'],
  },
  enclave: {
    m: ['Sszarak', 'Kesh', 'Tzalok', 'Xith', 'Ssilar', 'Rikkus', 'Zathrak', 'Hessk', 'Vashk', 'Ixtli', 'Kroth', 'Sethis', 'Tzul', 'Rassk', 'Ssorn', 'Quetz'],
    f: ['Sseria', 'Ixa', 'Nessath', 'Zhyra', 'Kissa', 'Thessil', 'Yssa', 'Vashtra', 'Sylith', 'Ressa', 'Shiva', 'Tlaxi', 'Xira', 'Zhass', 'Ishka', 'Nyssa'],
  },
  orcs: {
    m: ['Grommash', 'Thrall', 'Durotan', 'Karg', 'Grakk', 'Rokhan', 'Mukla', 'Zogg', 'Burz', 'Gash', 'Krog', 'Ruk', 'Skull', 'Throg', 'Uzg', 'Varok'],
    f: ['Garona', 'Aggra', 'Draka', 'Zuka', 'Rukha', 'Shakra', 'Gorza', 'Ulra', 'Morka', 'Bazga', 'Krisha', 'Thezra', 'Yarga', 'Grilla', 'Durza', 'Sorga'],
  },
  dwarves: {
    m: ['Dwalin', 'Thorin', 'Balin', 'Gimrik', 'Durin', 'Bofur', 'Brokk', 'Hargrim', 'Thrain', 'Korgan', 'Muradin', 'Orrin', 'Rurik', 'Torvald', 'Ulfgar', 'Bram'],
    f: ['Dagna', 'Helga', 'Brunhild', 'Dis', 'Ingrid', 'Sigrun', 'Thora', 'Astrid', 'Hilde', 'Runa', 'Kelda', 'Moira', 'Solveig', 'Freya', 'Gudrun', 'Brenna'],
  },
  conflux: {
    m: ['Terran', 'Ignis', 'Tidus', 'Boulder', 'Nimbus', 'Magmar', 'Glacius', 'Tempest', 'Quartz', 'Cirrus', 'Basalt', 'Torrent', 'Zephyr', 'Obsidian', 'Gale', 'Flint'],
    f: ['Aeris', 'Hydra', 'Zephyra', 'Pyra', 'Mistral', 'Cinder', 'Ember', 'Marina', 'Aurora', 'Brook', 'Coral', 'Sirocco', 'Lumina', 'Rain', 'Opal', 'Sola'],
  },
};
export function namesFor(fid, gender) {
  const g = GIVEN[fid] || GIVEN.castle;
  return g[gender === 'f' ? 'f' : 'm'];
}
