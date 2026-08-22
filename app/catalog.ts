export type MediaCategory = 'movie' | 'series';

export interface PlaybackSource {
  url: string;
  type: string;
  attribution: string;
  licenseUrl: string;
}

export interface MediaTitle {
  id: string;
  title: string;
  category: MediaCategory;
  year: number;
  rating: string;
  duration: string;
  match: number;
  genres: string[];
  description: string;
  cast: string[];
  director: string;
  tone: string;
  featured?: boolean;
  playable?: boolean;
  source?: PlaybackSource;
}

export const catalog: MediaTitle[] = [
  {
    id: 'big-buck-bunny', title: 'Big Buck Bunny', category: 'movie', year: 2008,
    rating: 'U', duration: '10m', match: 98, genres: ['Animation', 'Comedy', 'Open Film'],
    description: 'A gentle giant discovers that even the quietest meadow can hide a little chaos in this beloved Blender Foundation open movie.',
    cast: ['Big Buck Bunny', 'Frank', 'Rinky', 'Gamera'], director: 'Sacha Goedegebure', tone: 'meadow', featured: true, playable: true,
    source: { url: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Big_Buck_Bunny_4K.webm', type: 'video/webm', attribution: '© 2008 Blender Foundation | bigbuckbunny.org — CC BY 3.0', licenseUrl: 'https://peach.blender.org/about/' },
  },
  { id:'neon-divide', title:'Neon Divide', category:'series', year:2026, rating:'13+', duration:'1 season', match:94, genres:['Sci-Fi','Thriller'], description:'Two couriers race across a fractured megacity carrying a secret powerful enough to reunite it.', cast:['Mara Voss','Ari Chen'], director:'Kheyflix Studio', tone:'violet' },
  { id:'afterlight', title:'Afterlight', category:'movie', year:2025, rating:'16+', duration:'1h 48m', match:91, genres:['Drama','Mystery'], description:'A photographer returns to her coastal hometown and finds a roll of film that should not exist.', cast:['Lena Hart','Noah Vale'], director:'Mira Sol', tone:'sunset' },
  { id:'the-deep-blue', title:'The Deep Blue', category:'series', year:2026, rating:'7+', duration:'6 episodes', match:89, genres:['Documentary','Nature'], description:'A breathtaking expedition through the least explored habitats beneath the ocean surface.', cast:['Dr. Amara Cole'], director:'Kheyflix Earth', tone:'ocean' },
  { id:'dust-and-thunder', title:'Dust & Thunder', category:'movie', year:2024, rating:'16+', duration:'2h 03m', match:86, genres:['Action','Western'], description:'An outlaw mechanic and a principled marshal form an uneasy alliance across the badlands.', cast:['Jon Bell','Rae Maddox'], director:'Theo Crane', tone:'ember' },
  { id:'silent-orbit', title:'Silent Orbit', category:'movie', year:2026, rating:'13+', duration:'1h 56m', match:97, genres:['Sci-Fi','Drama'], description:'The last engineer aboard a drifting station receives a message sent from her own future.', cast:['Iris Okafor','Leon Venn'], director:'Anika Ross', tone:'space' },
  { id:'midnight-table', title:'The Midnight Table', category:'series', year:2025, rating:'13+', duration:'8 episodes', match:93, genres:['Drama','Food'], description:'Five strangers meet after hours in a hidden restaurant where every dish unlocks a memory.', cast:['Sofia Ren','Marc Duval'], director:'Kheyflix Studio', tone:'gold' },
  { id:'wild-current', title:'Wild Current', category:'series', year:2024, rating:'7+', duration:'2 seasons', match:88, genres:['Adventure','Nature'], description:'Young conservationists follow the rivers that sustain the planet’s most remote communities.', cast:['Nia Brooks'], director:'Kheyflix Earth', tone:'forest' },
  { id:'glass-house', title:'Glass House', category:'movie', year:2025, rating:'16+', duration:'1h 42m', match:84, genres:['Thriller','Mystery'], description:'An architect wakes inside her latest creation and realizes the smart home has rewritten its rules.', cast:['Eva North','Samir Khan'], director:'Ren Ito', tone:'ice' },
  { id:'paper-kingdom', title:'Paper Kingdom', category:'series', year:2026, rating:'7+', duration:'10 episodes', match:92, genres:['Animation','Family'], description:'A fearless paper fox explores a handcrafted world built from forgotten stories.', cast:['Milo Finch','Aya Reed'], director:'Kheyflix Animation', tone:'paper' },
  { id:'last-frequency', title:'Last Frequency', category:'movie', year:2023, rating:'13+', duration:'1h 36m', match:82, genres:['Music','Drama'], description:'A late-night radio host receives one final request from a caller lost twenty years ago.', cast:['June Hale','Owen Park'], director:'Dara Quinn', tone:'radio' },
  { id:'northbound', title:'Northbound', category:'series', year:2025, rating:'13+', duration:'6 episodes', match:90, genres:['Adventure','Drama'], description:'Three siblings follow an old map into a winter wilderness to finish their father’s journey.', cast:['Elle Frost','Kai Morgan'], director:'Tessa Wynn', tone:'snow' },
];

export const getTitle = (id: string) => catalog.find((item) => item.id === id);

export const searchCatalog = (query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return catalog.filter((item) => [item.title, item.description, item.director, ...item.genres, ...item.cast].join(' ').toLocaleLowerCase().includes(normalized));
};

export const rails = [
  { title: 'Trending on Kheyflix', ids: ['big-buck-bunny','neon-divide','afterlight','the-deep-blue','dust-and-thunder','silent-orbit'] },
  { title: 'Only on Kheyflix', ids: ['midnight-table','paper-kingdom','silent-orbit','neon-divide','northbound','glass-house'] },
  { title: 'Stories to get lost in', ids: ['wild-current','the-deep-blue','last-frequency','afterlight','dust-and-thunder','paper-kingdom'] },
];
