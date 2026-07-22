/* ============================================================
   Top Banana — an Apples-to-Apples-style judging game.

   Each round one player is the Banana Judge. The big screen
   shows a golden prompt card; everyone else secretly plays the
   answer card from their hand that matches it best (or worst,
   or funniest — the judge decides what wins!). The judge crowns
   a winner, who earns a banana. First to 5 bananas wins.

   All card text here is original content written for this game.
   ============================================================ */

import { escapeHtml, shuffle } from '../util.js';

const WIN_SCORE = 5;
const HAND_SIZE = 7;
const RESULT_MS = 5200;

/* ---------------- original card content ---------------- */

const PROMPTS = [
  'Suspiciously sticky', 'Absolutely majestic', 'Terrible at parties', 'Weirdly delicious',
  'Grandma-approved', 'Illegal in space', 'Extremely wiggly', 'Wildly overrated',
  'Secretly underrated', 'Mildly haunted', 'Surprisingly expensive', 'Great at hide-and-seek',
  'Way too loud', 'Dangerously cheesy', 'Extra fancy', 'Impossible to fold',
  'Better with sprinkles', 'Pure chaos', 'Smells like victory', 'Older than the internet',
  'Good in a sandwich', 'Too hot to handle', 'Invisible on Tuesdays', 'Aggressively sparkly',
  'The world\u2019s worst gift', 'Very ticklish', 'Faster than a toddler', 'Extra crunchy',
  'Extremely slippery', 'Mysteriously missing', 'Perfect for karaoke', 'Unreasonably bouncy',
  'Stronger than it looks', 'Full of secrets', 'Terrifying but cute', 'Deeply dramatic',
  'Allergic to Mondays', 'Champion material', 'Highly suspicious', 'Glow-in-the-dark',
  'Unbearably fluffy', 'A little too honest', 'Ninety percent glitter', 'Banned from the library',
  'Shockingly polite', 'Always late', 'Secretly a robot', 'Squeaky',
  "Impossible to ignore", "Slightly radioactive",
  "Best served cold", "Wanted in three states",
  "Suspiciously quiet", "Powered by snacks",
  "Legally a boat", "Afraid of the dark",
  "Immune to bedtime", "Softer than it should be",
  "Louder than a fire drill", "Definitely cursed",
  "Blessed by a wizard", "Made of pure luck",
  "Allergic to water", "Great at math",
  "Terrible at math", "Born to dance",
  "Too big for the elevator", "Small but mighty",
  "Approved by dentists", "Feared by dentists",
  "Covered in frosting", "Downloadable",
  "Sold out everywhere", "On sale forever",
  "Endorsed by pirates", "Raised by wolves",
  "Fluent in dolphin", "Batteries not included",
  "Some assembly required", "Fresh out of the oven",
  "Frozen solid", "Microwave safe",
  "Definitely not microwave safe", "Machine washable",
  "Dry clean only", "A national treasure",
  "A cry for help", "An acquired taste",
  "Chewier than expected", "Crunchier than expected",
  "Best before 1987", "Scientifically impossible",
  "Peer reviewed", "Held together with tape",
  "Running on fumes", "Fueled by spite",
  "Powered by friendship", "Full of bees",
  "Absolutely full of beans", "Waterproof-ish",
  "Fireproof, allegedly", "Certified organic",
  "Vaguely magnetic", "Highly collectible",
  "Non-refundable", "Fully refundable",
  "Slightly used", "Brand new, never opened",
  "Signed by a celebrity", "Autographed by a raccoon",
  "Whisper quiet", "Deafening",
  "Minty fresh", "Weirdly warm",
  "Suspiciously cold", "Denser than a bowling ball",
  "Lighter than air", "Sharper than it looks",
  "Rounder than necessary", "Perfectly seasoned",
  "Under-seasoned", "Over-caffeinated",
  "Decaf", "In witness protection",
  "On its ninth life", "Freshly waxed",
  "Buffed to a shine", "Rustproof",
  "Vintage", "Futuristic",
  "Ahead of its time", "Behind schedule",
  "Right on time", "Fashionably late",
  "First in line", "Last picked in gym class",
  "Team captain material", "Benched for attitude",
  "MVP of nothing", "Undefeated",
  "Retired champion", "Making a comeback",
  "Past its prime", "Peaking right now",
  "Trending", "Cancelled",
  "Rebooted", "Straight to DVD",
  "Critically acclaimed", "Panned by critics",
  "Box office gold", "A slow burn",
  "Bingeable", "Family friendly",
  "Rated arrr by pirates", "Educational, technically",
  "Not FDA approved", "Doctor recommended",
  "Grandpa’s favorite", "The babysitter’s nightmare",
  "Teacher’s pet material", "Principal’s office regular",
  "Homework resistant", "Pop quiz ready",
  "Show and tell worthy", "Confiscated at recess",
  "Traded for two cookies", "Worth its weight in gold",
  "Worth its weight in gummy bears", "Priceless",
  "Worthless but beloved", "Insured for millions",
  "Found in the couch cushions", "Lost in the mail",
  "Delivered to the wrong house", "Shipped overnight",
  "Backordered until spring", "Handmade with questionable love",
  "Mass produced", "One of a kind",
  "A limited edition", "A knockoff",
  "Surprisingly aerodynamic", "Not aerodynamic at all",
  "Street legal", "Barely street legal",
  "Off-road ready", "Parallel parked perfectly",
  "Double parked", "Out of gas",
  "Solar powered", "Wind powered",
  "Hamster powered", "Whistle clean",
  "Covered in crumbs", "Dipped in chocolate",
  "Rolled in sprinkles", "Deep fried",
  "Lightly toasted", "Burnt to a crisp",
  "Al dente", "Extra saucy",
  "Gluten curious", "Sugar free, sadly",
  "Double stuffed", "Bite sized",
  "Family sized", "Jumbo",
  "Fun sized", "Travel sized",
  "Pocket sized", "Too big to fail",
  "Too cute to punish", "Too slow for the bus",
  "Fast enough to worry about", "Built for speed",
  "Built for comfort", "Built to last",
  "Built yesterday", "Assembled incorrectly",
  "Missing one screw", "Extra screws left over",
  "Under warranty", "Warranty voided",
  "Haunted, but politely", "Possessed by a mime",
  "Blessed with good hair", "Cursed with great taste",
  "Born lucky", "Out of luck",
  "Pressing its luck", "Lucky by accident",
  "Statistically unlikely", "Mathematically perfect",
  "Geometrically confusing", "Historically inaccurate",
  "Museum quality", "Garage sale quality",
  "Award winning", "Participation trophy level",
  "Hall of fame bound", "Banned from the buffet",
  "Welcome anywhere", "Not welcome at weddings",
  "Invited to everything", "Never invited back",
  "The life of the party", "The reason the party ended",
];

const ANSWERS = [
  'A sock full of pudding', 'My neighbor\u2019s lawn flamingo', 'A grumpy walrus',
  'The last slice of pizza', 'A trampoline in the kitchen', 'Grandpa\u2019s dance moves',
  'A suitcase of rubber ducks', 'The school mascot', 'A sneeze in slow motion',
  'Bubble wrap', 'A wizard\u2019s grocery list', 'The office printer',
  'A cat in a tuxedo', 'Homework', 'A haunted vending machine',
  'A llama on rollerblades', 'The moon', 'Ketchup on ice cream',
  'A very long escalator', 'Uncle Gary\u2019s karaoke night', 'A pirate\u2019s retirement party',
  'The world\u2019s smallest violin', 'A traffic cone', 'Glitter glue',
  'An aggressive pigeon', 'The five-second rule', 'A ninja librarian',
  'Soup eaten with a fork', 'My imaginary friend', 'A screaming goat',
  'The Bermuda Triangle', 'A jar of expired mayonnaise', 'Velcro shoes',
  'A dramatic hamster', 'The last donut in the box', 'A wobbly shopping cart',
  'Elevator music', 'A garden gnome uprising', 'Surprise homework on Friday',
  'A whoopee cushion orchestra', 'The dentist\u2019s waiting room', 'A potato wearing sunglasses',
  'Synchronized swimming', 'A porcupine hug', 'The end of the rainbow',
  'A malfunctioning robot butler', 'Cafeteria mystery meat', 'A yodeling contest',
  'Quicksand', 'A sloth marathon', 'The world\u2019s stickiest handshake',
  'A parade of penguins', 'Dad jokes', 'A unicycle built for two',
  'The missing TV remote', 'A sandwich with too much mustard', 'Interpretive dance',
  'My 3 a.m. thoughts', 'A T-rex trying to clap', 'The neighbor\u2019s wifi password',
  'A suspicious puddle', 'Competitive napping', 'A moose in a canoe',
  'The last day of summer', 'A vampire at the beach', 'Lukewarm bathwater',
  'A squirrel with a plan', 'The gym membership nobody uses', 'A one-man kazoo band',
  'Mismatched socks', 'A raccoon in a trench coat', 'The snooze button',
  'A very serious clown', 'Expired coupons', 'A jellyfish handshake',
  'The line at the DMV', 'A karate-chopping grandma', 'Free samples',
  'A drawbridge that\u2019s always up', 'My evil twin', 'A tap-dancing octopus',
  'The world\u2019s largest rubber band ball', 'A silent disco', 'Overdue library books',
  'A sentient tumbleweed', 'The bottom of the cereal box', 'A polite tornado',
  'Escaped zoo flamingos', 'A couch cushion fort', 'A microwave burrito',
  'Deep-sea karaoke', 'A suspiciously calm toddler', 'The office holiday party',
  'A hedgehog in a hard hat', 'Instant noodles', 'A jousting lawnmower',
  'The seventh movie sequel', 'A disco ball in the shower', 'Cold french fries',
  'A very lost tourist', 'The record for longest hiccup', 'A caffeinated chihuahua',
  'My secret snack drawer', 'A revolving door race', 'A bear on a tiny bicycle',
  'Wet socks', 'A committee of owls', 'The last parking spot',
  'A dramatic slow-motion run', 'Homemade slime', 'A politely honking goose',
  'The mystery smell in the car', 'A knight in squeaky armor', 'An air guitar solo',
  'A very ambitious ant', 'The escalator to nowhere', 'A pillow fight championship',
  'Extra pickles', 'A ghost who pays rent', 'The juice box of destiny',
  "A pigeon with a business plan", "Three ducks in a raincoat",
  "A hamster on a coffee break", "An octopus folding laundry",
  "A giraffe in a convertible", "A crab running a lemonade stand",
  "A very judgmental cat", "A dog who knows your secrets",
  "A parrot that only says no", "A turtle late for work",
  "A flamingo on stilts", "An owl with insomnia",
  "A penguin in flip-flops", "A goat on the roof again",
  "A snail with racing stripes", "A llama with a library card",
  "An alpaca packing a suitcase", "A walrus doing yoga",
  "A shark afraid of the water", "A worm in a tiny scarf",
  "A duck who demands bread", "A hummingbird with decaf",
  "A sleepy grizzly in a hammock", "A lobster playing the drums",
  "A chicken crossing the road for reasons", "A cow on a pogo stick",
  "A horse in an elevator", "A donkey with a podcast",
  "A ferret in a fanny pack", "A koala clinging to the wifi router",
  "A kangaroo with empty pockets", "A platypus with a nametag",
  "A beaver reviewing dams online", "An eel in a bathtub",
  "A pufferfish holding its breath", "A seagull eyeing your fries",
  "A very fast tortoise", "A spider knitting a sweater",
  "An ant carrying a whole sandwich", "A moth in love with a lamp",
  "A firefly with a dead battery", "A bee with allergies",
  "A butterfly with stage fright", "A crocodile wearing floaties",
  "A gecko stuck to the ceiling fan", "A chameleon that’s bad at hiding",
  "A skunk with cologne", "A porcupine in bubble wrap",
  "A raccoon auditing the trash", "A squirrel with a savings account",
  "A chipmunk hoarding ping-pong balls", "A bat sleeping in on Saturday",
  "A wolf who cried boy", "A fox with a rewards card",
  "A badger reading the fine print", "A mole with a flashlight",
  "An otter holding hands with a rock", "A dolphin doing taxes",
  "A whale in a kiddie pool", "A moose fact-checking a map",
  "A pancake the size of a car", "Spaghetti tied in a bow",
  "A waffle used as a doormat", "A pizza folded into origami",
  "The world’s spiciest marshmallow", "A taco that fell apart immediately",
  "A burrito the size of a sleeping bag", "Soup that’s mostly croutons",
  "A pretzel tied by a sailor", "Cereal without the milk",
  "Milk without the cereal", "A banana at maximum ripeness",
  "An avocado that’s ripe for one minute", "A watermelon with no seeds and no flavor",
  "Grapes that are secretly raisins", "A pickle in a fancy jar",
  "Cheese that squeaks", "A baguette used as a sword",
  "A croissant with a French accent", "A donut rolling downhill",
  "A cupcake in witness protection", "A birthday cake with trick candles",
  "A gingerbread house with a mortgage", "A candy cane in July",
  "Chocolate coins that are just coins", "A gumball that lost its flavor",
  "A jawbreaker that won", "Cotton candy in the rain",
  "A snow cone in a heat wave", "An ice cream cone with a leak",
  "A popsicle with two sticks", "The heel of the bread loaf",
  "A sandwich cut diagonally, as it should be", "A peanut butter and pickle sandwich",
  "Jelly on the ceiling", "A ketchup packet that won’t open",
  "A mustard stain shaped like a dog", "Mayonnaise at a fancy restaurant",
  "Hot sauce named after a disaster", "A salad that’s mostly candy",
  "A smoothie with mystery chunks", "A juice box with attitude",
  "Chocolate milk from a brown cow", "A tea party with no tea",
  "Coffee strong enough to walk", "Decaf, served with an apology",
  "A soda that lost its fizz", "Sparkling water that’s too spicy",
  "An onion with layers of drama", "Garlic bread as a love language",
  "A potato that dreams of being fries", "Fries at the bottom of the bag",
  "A nugget shaped like a famous landmark", "Leftovers labeled do not eat",
  "The mystery casserole", "A fruitcake from 1994",
  "A vending machine snack stuck mid-fall", "The last chip in the bag",
  "Popcorn kernels that never popped", "A marshmallow roasted to perfection",
  "A remote control with no batteries", "A phone at 1% battery",
  "A charger that only works at an angle", "Headphones tangled beyond rescue",
  "A wifi signal with one bar", "A password with seventeen requirements",
  "A printer that smells fear", "A computer with 74 tabs open",
  "An update that takes forever", "A robot vacuum with a grudge",
  "A smart fridge that judges you", "A toaster that launches toast",
  "A blender at 6 a.m.", "An alarm clock with no mercy",
  "A mattress with one weird spring", "A pillow that’s cold on both sides",
  "A blanket that’s never big enough", "A fitted sheet that refuses to fold",
  "The one sock the dryer spared", "A washing machine full of tissues",
  "An iron that only makes wrinkles", "A vacuum that ate a toy brick",
  "A toy brick waiting in the dark", "A rug that’s seen too much",
  "A lamp that flickers in Morse code", "A ceiling fan on maximum",
  "A door that opens both ways", "A push door clearly labeled pull",
  "A squeaky floorboard that snitches", "A window that won’t stay open",
  "Curtains that block no light", "A doorbell that plays a whole song",
  "A welcome mat that means it", "A garden hose with a knot",
  "A sprinkler that waits for you", "A lawnmower at sunrise",
  "A leaf blower symphony", "A garden gnome with a passport",
  "A birdhouse with strict neighbors", "A mailbox full of coupons",
  "An umbrella that flips inside out", "A kite stuck in the only tree",
  "A boomerang that never came back", "A frisbee on the roof",
  "A pogo stick with a mind of its own", "A skateboard with square wheels",
  "A bicycle bell that startles everyone", "Training wheels on a race bike",
  "A helmet with flame stickers", "A scooter left in the hallway",
  "Roller skates on a gravel road", "A trampoline with a no-flips rule",
  "A pool noodle sword", "Floaties on a submarine",
  "A beach ball in a business meeting", "Sunscreen applied by a five-year-old",
  "A sandcastle with a moat", "A metal detector finding bottle caps",
  "A treasure map to the fridge", "An X that marks the wrong spot",
  "A compass that points to snacks", "A backpack with one broken zipper",
  "A pencil with no eraser", "An eraser worn down to a crumb",
  "A pen that skips", "A marker without its cap",
  "Glitter that never leaves", "Tape that lost its end",
  "Left-handed scissors in a right-handed world", "A stapler with one staple left",
  "A paperclip chain ten feet long", "Sticky notes losing their stick",
  "A whiteboard marker running dry", "A calculator that shows its work",
  "A ruler that’s slightly bent", "A protractor waiting for its moment",
  "A globe that spins too well", "A dictionary used as a doorstop",
  "An encyclopedia set from 1989", "A bookmark lost inside its own book",
  "The moment the music stops in musical chairs", "Waving back at someone waving behind you",
  "Calling shotgun from inside the house", "The middle seat on a long flight",
  "A group project with one worker", "The last day before vacation",
  "The first day back from vacation", "A staring contest with a statue",
  "Winning an argument in the shower", "Remembering the comeback three days later",
  "The silence after a bad joke", "Laughing at the wrong moment",
  "A sneeze that never arrives", "A yawn in a quiet room",
  "Hiccups during a speech", "A stomach growl in a library",
  "Tripping over nothing", "Recovering from a trip with a jog",
  "The walk back for forgotten keys", "Waving at your own reflection",
  "A high five that misses", "A handshake that becomes a fist bump",
  "A hug that lasts too long", "Clapping when the plane lands",
  "Singing the wrong lyrics loudly", "Humming a song nobody knows",
  "A dance move from another decade", "The sprinkler dance at a wedding",
  "Karaoke with no volume control", "An encore nobody requested",
  "A magic trick that reveals itself", "A magician’s day off",
  "Juggling one ball", "A mime stuck in a real box",
  "A ventriloquist arguing with the dummy", "A clown car with one clown",
  "A parade for no reason", "A marching band in the living room",
  "A drum solo at midnight", "A recorder concert in an elevator",
  "Bagpipes at breakfast", "An accordion at full volume",
  "A kazoo national anthem", "A triangle player’s big moment",
  "The intermission that never ends", "A standing ovation for the snack table",
  "A plot twist everyone saw coming", "A sequel nobody asked for",
  "Spoilers from a stranger", "Credits with a secret scene",
  "A trailer that shows the whole movie", "A cliffhanger before bedtime",
  "A bedtime story with 12 endings", "A lullaby that wakes the baby",
  "A nap that lasts four hours", "Waking up before the alarm",
  "Snoozing through three alarms", "A dream about being late",
  "Falling asleep mid-sentence", "A pillow fort with a guest list",
  "A blanket burrito with no exit", "Slippers on the wrong feet",
  "Pajamas at the grocery store", "A bathrobe worn like a cape",
  "A cape at a job interview", "A costume in April",
  "A wig in a windstorm", "A mustache that’s clearly fake",
  "Sunglasses indoors", "A monocle for reading menus",
  "A top hat at the gym", "A crown from a fast food place",
  "A tiara at the license office", "A tuxedo t-shirt",
  "Socks with sandals, proudly", "A belt and suspenders together",
  "Light-up shoes in a dark theater", "Velcro at a silent retreat",
  "A zipper stuck at the worst time", "A button that flies off dramatically",
  "A knight afraid of dragons", "A dragon who collects coupons",
  "A wizard with a learner’s permit", "A witch with a broom allergy",
  "A fairy godmother on lunch break", "A genie with fine print",
  "A mermaid in a swim class", "A pirate with seasickness",
  "A viking in a paddle boat", "A cowboy on a carousel horse",
  "A ninja with hiccups", "A samurai trimming hedges",
  "A superhero with a day job", "A sidekick asking for a raise",
  "A villain with a great skincare routine", "A henchman with a suggestion box",
  "A mad scientist’s intern", "A robot learning to whistle",
  "An alien at a yard sale", "A bigfoot with tiny shoes",
  "The Loch Ness lifeguard", "A yeti with a hair dryer",
  "A ghost afraid of the dark", "A zombie on a juice cleanse",
  "A vampire with a garlic bread weakness", "A werewolf with a lint roller",
  "A mummy in a three-legged race", "A skeleton with a gym membership",
  "A gargoyle with great posture", "A troll under a toll bridge",
  "An elf who’s tall", "A giant who ducks through doorways",
  "A leprechaun with a piggy bank", "A unicorn stuck in traffic",
  "A centaur at the shoe store", "A minotaur lost in a hedge maze",
  "A sphinx that forgot the riddle", "A jester with no material",
  "A king who lost the remote", "A queen of a very small castle",
  "A prince, charming-ish", "A princess with a pet dragon",
  "A royal taste tester", "A town crier with laryngitis",
  "A blacksmith making spoons", "A juggler with butterfingers",
  "A fortune teller who’s always right about lunch", "A tightrope walker on the curb",
  "A strongman lifting groceries", "A ringmaster of a flea circus",
  "A lion tamer with a house cat", "An acrobat doing chores",
  "A detective who lost his keys", "A spy with a loud ringtone",
  "A secret agent in a hair net", "A lifeguard at a puddle",
  "A referee at a pillow fight", "A coach who loves the whistle too much",
  "An umpire who needs glasses", "A mascot in a heat wave",
  "The seat that’s still warm", "The spot where the remote should be",
  "The drawer full of mystery cables", "The junk drawer’s deepest corner",
  "The shelf just out of reach", "The step everyone forgets is there",
  "The corner where dust bunnies meet", "Under the bed, where socks vanish",
  "The attic box labeled misc", "A basement with one flickering light",
  "A garage with no room for the car", "A shed full of one of everything",
  "A treehouse with a strict password", "A clubhouse with no club",
  "A lemonade stand with dynamic pricing", "A yard sale where nothing has prices",
  "A garage band’s first single", "An open mic night gone quiet",
  "A talent show with one talent", "A spelling bee tiebreaker",
  "A science fair volcano", "A diorama due tomorrow",
  "A book report on a movie", "A field trip permission slip, unsigned",
  "The school bus seat behind the driver", "A fire drill during a test",
  "Picture day with a new haircut", "The cafeteria’s taco Tuesday",
  "Gym class dodgeball finals", "The rope climb in gym class",
  "A pep rally at full pep", "The lost and found bin",
  "A hall pass shaped like a toilet seat", "Detention for laughing",
  "A snow day announced too late", "Summer reading, unread",
  "The first pencil of the school year", "A backpack on the last day",
  "Graduation caps mid-air", "A yearbook signed have a great summer",
  "The DJ’s third airhorn", "A conga line with no end",
  "A limbo stick set too low", "A piñata that fights back",
  "Party hats on serious people", "A balloon animal with extra legs",
  "A bounce house for adults", "Musical chairs with one chair",
  "Pin the tail, wildly off target", "A goody bag with one jellybean",
  "Cake at the office for no reason", "The office thermostat wars",
  "A meeting that could have been an email", "A reply-all catastrophe",
  "A conference call with a dog barking", "The mute button betrayal",
  "A keyboard with a sticky spacebar", "The office plant that outlasted everyone",
  "A water cooler with hot takes", "Casual Friday taken too far",
  "A briefcase full of snacks", "A necktie tied by a toddler",
  "An elevator with all buttons pressed", "Small talk about the weather, again",
  "A handshake rehearsed in the mirror", "A nametag with a nickname",
  "The break room’s mystery mug", "A stapler that went missing Monday",
  "An out-of-office reply from 2019", "A parking spot painted too small",
  "A toll booth with exact change only", "A roundabout with five exits",
  "A GPS recalculating with attitude", "A road trip playlist on repeat",
  "The backseat’s are-we-there-yet", "A rest stop vending dinner",
  "A map folded the wrong way", "A detour through a corn maze",
  "A speed bump taken too fast", "A car wash with the window cracked",
  "Drive-thru orders shouted twice", "The gas cap on the other side",
  "A parallel parking audience", "Bumper stickers telling a life story",
  "A car alarm nobody checks on", "Fuzzy dice with opinions",
  "A spare tire named Old Reliable", "A bike bell in a traffic jam",
  "A crosswalk countdown sprint", "Jaywalking pigeons",
  "A bus that’s early for once", "A train door closing dramatically",
  "An airport gate change marathon", "A suitcase three pounds over",
  "The baggage carousel’s lone bag", "A window seat with no window",
  "Turbulence during the drink service", "A layover in a snow globe",
  "A passport photo from a decade ago", "Souvenir shirts for the whole family",
  "A postcard that arrived after you did", "A hotel pillow fortress",
  "The do-not-disturb sign, ignored", "A minibar candy bar for nine dollars",
  "A continental breakfast waffle line", "A pool with a no-cannonballs sign",
  "A cannonball with full commitment", "The kiddie pool’s deep end",
  "Goggles that fog instantly", "A swim cap one size too small",
  "A diving board hesitation", "The lazy river’s traffic jam",
  "A waterslide with a countdown", "A beach towel that’s all sand",
  "A seashell that sounds like traffic", "A crab in the sandcastle moat",
  "A tide that erased the masterpiece", "Flip-flops on hot pavement",
  "A sunburn shaped like sunglasses", "An ice cream truck two streets away",
  "The ice cream truck song at night", "A snowman in the garage freezer",
  "A snowball saved since January", "Mittens on a string",
  "A scarf longer than its owner", "A sled with racing ambitions",
  "An igloo with a doorbell", "Hot cocoa with too many marshmallows",
  "A snow angel in fresh powder", "The first footprints in the snow",
  "An icicle sword fight", "A driveway that needs shoveling",
  "A snowplow’s morning wake-up call", "A puddle pretending to be shallow",
  "Galoshes in a drizzle", "An umbrella for two, used by one",
  "A rainbow with no end in sight", "A thunderclap during hide-and-seek",
  "A weather forecast that’s just a shrug", "A tornado drill in a tuxedo",
  "A windsock with big dreams", "A cloud shaped like a dinosaur",
  "Fog with a flair for drama", "Sweater weather in July",
  "A moon that follows the car", "A star that’s probably a plane",
  "A telescope pointed at nothing", "A constellation shaped like a sandwich",
  "A meteor shower during nap time", "An eclipse viewed through cereal box glasses",
  "Gravity working overtime", "A black hole for left socks",
  "A rocket built from cardboard", "An astronaut afraid of heights",
  "A moon rock that’s probably gravel", "A satellite with one job",
  "A UFO that’s clearly a frisbee", "Mission control’s coffee run",
  "A countdown that starts over", "The world’s most confident weather report",
];

/* ---------------- helpers ---------------- */

/* ============================================================
   HOST (big screen)
   ============================================================ */
function createHost(ctx) {
  let deck = shuffle(ANSWERS);
  let discard = [];
  let prompts = shuffle(PROMPTS);

  const hands = new Map();        // playerId -> [cards]
  const scores = new Map();       // playerId -> n
  let seats = [];                 // playerIds in join order (fixed judge rotation)
  let judgeIdx = -1;
  let phase = 'idle';             // 'submit' | 'judge' | 'result' | 'gameover' | 'paused'
  let judgeId = null;
  let prompt = null;
  let submissions = [];           // [{playerId, card, key}]
  let resultTimer = null;
  let el = {};                    // cached DOM refs

  /* ---------- deck utilities ---------- */
  function draw() {
    if (deck.length === 0) { deck = shuffle(discard); discard = []; }
    return deck.pop();
  }
  function refillHand(id) {
    const h = hands.get(id) || [];
    while (h.length < HAND_SIZE && (deck.length || discard.length)) h.push(draw());
    hands.set(id, h);
  }

  function connectedSeats() {
    const live = new Set(ctx.players().filter((p) => p.connected).map((p) => p.id));
    return seats.filter((id) => live.has(id));
  }
  function playerById(id) {
    return ctx.players().find((p) => p.id === id) || null;
  }

  /* ---------- rendering ---------- */
  function renderShell() {
    ctx.root.innerHTML = `
      <div class="tb-host">
        <aside class="tb-scoreboard">
          <h3>🍌 Bananas</h3>
          <div class="tb-scores"></div>
          <div class="tb-goal">First to ${WIN_SCORE} wins</div>
        </aside>
        <main class="tb-stage">
          <div class="tb-round-label"></div>
          <div class="tb-prompt-card"><span class="tb-prompt-text"></span></div>
          <div class="tb-stage-status"></div>
          <div class="tb-submissions"></div>
          <div class="tb-banner hidden"></div>
        </main>
      </div>`;
    el = {
      scores: ctx.root.querySelector('.tb-scores'),
      roundLabel: ctx.root.querySelector('.tb-round-label'),
      promptCard: ctx.root.querySelector('.tb-prompt-card'),
      promptText: ctx.root.querySelector('.tb-prompt-text'),
      status: ctx.root.querySelector('.tb-stage-status'),
      subs: ctx.root.querySelector('.tb-submissions'),
      banner: ctx.root.querySelector('.tb-banner'),
    };
  }

  function renderScores() {
    el.scores.innerHTML = '';
    for (const id of seats) {
      const p = playerById(id);
      if (!p) continue;
      const row = document.createElement('div');
      row.className = 'tb-score-row'
        + (id === judgeId && (phase === 'submit' || phase === 'judge') ? ' judge' : '')
        + (p.connected ? '' : ' offline');
      row.style.setProperty('--pc', p.color);
      const n = scores.get(id) || 0;
      row.innerHTML = `
        <span class="tb-score-avatar">${p.avatar}</span>
        <span class="tb-score-name">${escapeHtml(p.name)}</span>
        <span class="tb-score-bananas">${'🍌'.repeat(n) || '<span class="tb-zero">–</span>'}</span>`;
      el.scores.appendChild(row);
    }
  }

  function renderSubmissionSlots() {
    el.subs.innerHTML = '';
    const expected = connectedSeats().filter((id) => id !== judgeId);
    for (const id of expected) {
      const got = submissions.some((s) => s.playerId === id);
      const slot = document.createElement('div');
      slot.className = 'tb-card tb-card-back' + (got ? ' in' : ' waiting');
      slot.dataset.pid = id;
      slot.innerHTML = got ? '<span class="tb-card-back-mark">🍌</span>' : '';
      el.subs.appendChild(slot);
    }
  }

  function revealSubmissions() {
    el.subs.innerHTML = '';
    for (const s of submissions) {
      const card = document.createElement('div');
      card.className = 'tb-card tb-card-face';
      card.dataset.key = s.key;
      card.innerHTML = `<span>${escapeHtml(s.card)}</span>`;
      el.subs.appendChild(card);
    }
  }

  function showBanner(html, cls) {
    el.banner.className = 'tb-banner ' + (cls || '');
    el.banner.innerHTML = html;
  }
  function hideBanner() { el.banner.className = 'tb-banner hidden'; }

  function confettiHtml(count) {
    const colors = ['#ff4d6d', '#ff9f4a', '#ffd93d', '#6bcf7f', '#4dabf7', '#b380ff', '#ff7ab8'];
    let html = '';
    for (let i = 0; i < count; i++) {
      const left = (Math.random() * 100).toFixed(1);
      const delay = (Math.random() * 1.4).toFixed(2);
      const dur = (2.2 + Math.random() * 1.6).toFixed(2);
      const rot = Math.round(360 + Math.random() * 720) * (Math.random() < 0.5 ? -1 : 1);
      const w = Math.round(7 + Math.random() * 8);
      const h = Math.round(10 + Math.random() * 10);
      const c = colors[i % colors.length];
      html += `<span class="tb-confetti" style="left:${left}%;width:${w}px;height:${h}px;--c:${c};--d:${delay}s;--t:${dur}s;--r:${rot}deg"></span>`;
    }
    return html;
  }

  function clearOverlay() {
    for (const ov of ctx.root.querySelectorAll('.tb-winner-overlay')) ov.remove();
  }

  function showWinnerOverlay(winner, card, bananas) {
    clearOverlay();
    const ov = document.createElement('div');
    ov.className = 'tb-winner-overlay';
    ov.innerHTML = confettiHtml(90) + `
      <div class="tb-winner-box">
        <div class="tb-winner-avatar">${winner ? winner.avatar : '🏆'}</div>
        <div class="tb-winner-title">${escapeHtml(winner ? winner.name : '?')} wins the round!</div>
        <div class="tb-winner-card">“${escapeHtml(card)}”</div>
        <div class="tb-winner-bananas">🍌 ${bananas} of ${WIN_SCORE} bananas</div>
      </div>`;
    ctx.root.appendChild(ov);
  }

  /* ---------- round flow ---------- */
  function startRound() {
    clearTimeout(resultTimer);
    hideBanner();
    clearOverlay();

    // Seat anyone who joined since last round.
    for (const p of ctx.players()) {
      if (!seats.includes(p.id)) {
        seats.push(p.id);
        scores.set(p.id, scores.get(p.id) || 0);
      }
      refillHand(p.id);
    }

    const live = connectedSeats();
    if (live.length < 3) { pauseGame(); return; }

    // Rotate to the next connected judge.
    do { judgeIdx = (judgeIdx + 1) % seats.length; }
    while (!live.includes(seats[judgeIdx]));
    judgeId = seats[judgeIdx];

    if (prompts.length === 0) prompts = shuffle(PROMPTS);
    prompt = prompts.pop();
    submissions = [];
    phase = 'submit';

    const judge = playerById(judgeId);
    el.roundLabel.textContent = `${judge.avatar} ${judge.name} is the Banana Judge`;
    el.promptText.textContent = prompt;
    el.promptCard.classList.add('deal');
    setTimeout(() => el.promptCard.classList.remove('deal'), 600);
    el.status.textContent = 'Everyone: play your best match from your phone!';
    renderScores();
    renderSubmissionSlots();

    // Deal views to phones.
    for (const id of live) {
      if (id === judgeId) {
        ctx.sendTo(id, { v: 'judge-wait', prompt, got: 0, total: live.length - 1 });
      } else {
        sendHand(id);
      }
    }
  }

  function sendHand(id) {
    ctx.sendTo(id, {
      v: 'hand',
      prompt,
      judgeName: (playerById(judgeId) || {}).name || '?',
      cards: hands.get(id) || [],
    });
  }

  function pauseGame() {
    phase = 'paused';
    el.status.textContent = '';
    showBanner('😴 Need at least 3 connected players.<br>Waiting for friends to (re)join…', 'pause');
    ctx.sendAll({ v: 'wait', text: 'Waiting for more players…' });
    renderScores();
  }

  function maybeStartJudging() {
    const expected = connectedSeats().filter((id) => id !== judgeId);
    const done = expected.every((id) => submissions.some((s) => s.playerId === id));
    if (!done || submissions.length === 0) return;

    phase = 'judge';
    submissions = shuffle(submissions).map((s, i) => ({ ...s, key: 'k' + i }));
    revealSubmissions();
    const judge = playerById(judgeId);
    el.status.textContent = `👀 ${judge.name} is choosing the Top Banana…`;

    ctx.sendTo(judgeId, {
      v: 'judge-pick',
      prompt,
      options: submissions.map((s) => ({ key: s.key, text: s.card })),
    });
    for (const s of submissions) {
      ctx.sendTo(s.playerId, { v: 'submitted-wait', text: 'Cards are in! The judge is deciding…' });
    }
  }

  function crownWinner(key) {
    const winning = submissions.find((s) => s.key === key);
    if (!winning) return;
    phase = 'result';

    const winner = playerById(winning.playerId);
    scores.set(winning.playerId, (scores.get(winning.playerId) || 0) + 1);

    // Highlight the winning card, dim the rest.
    for (const cardEl of el.subs.children) {
      cardEl.classList.add(cardEl.dataset.key === key ? 'winner' : 'loser');
    }
    el.status.textContent = '';
    showWinnerOverlay(winner, winning.card, scores.get(winning.playerId) || 0);
    renderScores();

    for (const s of submissions) discard.push(s.card);
    for (const id of connectedSeats()) {
      ctx.sendTo(id, {
        v: 'round-result',
        winnerName: winner ? winner.name : '?',
        card: winning.card,
        youWon: id === winning.playerId,
      });
    }

    const total = scores.get(winning.playerId) || 0;
    resultTimer = setTimeout(() => {
      if (total >= WIN_SCORE) endGame(winning.playerId);
      else startRound();
    }, RESULT_MS);
  }

  function endGame(winnerId) {
    phase = 'gameover';
    clearOverlay();
    const rain = document.createElement('div');
    rain.className = 'tb-winner-overlay celebrate';
    rain.innerHTML = confettiHtml(120);
    ctx.root.appendChild(rain);
    const w = playerById(winnerId);
    el.roundLabel.textContent = '';
    el.promptCard.classList.add('hidden');
    el.subs.innerHTML = '';
    el.status.textContent = '';
    showBanner(`
      <div class="tb-gameover-emoji">🍌👑</div>
      <div class="tb-gameover-title">${escapeHtml(w ? w.name : '?')} is the Top Banana!</div>
      <div class="tb-gameover-btns">
        <button class="tb-btn" data-act="again">Play again</button>
        <button class="tb-btn tb-btn-soft" data-act="menu">Back to menu</button>
      </div>`, 'gameover');
    renderScores();
    ctx.sendAll({ v: 'gameover', winnerName: w ? w.name : '?' });

    el.banner.querySelector('[data-act="again"]').addEventListener('click', resetGame);
    el.banner.querySelector('[data-act="menu"]').addEventListener('click', () => ctx.exit());
  }

  function resetGame() {
    clearOverlay();
    deck = shuffle(ANSWERS);
    discard = [];
    prompts = shuffle(PROMPTS);
    hands.clear();
    for (const id of seats) scores.set(id, 0);
    judgeIdx = -1;
    el.promptCard.classList.remove('hidden');
    startRound();
  }

  /* ---------- per-player view resend (rejoin) ---------- */
  function resendView(id) {
    if (phase === 'paused') { ctx.sendTo(id, { v: 'wait', text: 'Waiting for more players…' }); return; }
    if (phase === 'gameover') { ctx.sendTo(id, { v: 'gameover', winnerName: '' }); return; }
    if (phase === 'submit') {
      if (id === judgeId) {
        const expected = connectedSeats().filter((x) => x !== judgeId);
        ctx.sendTo(id, { v: 'judge-wait', prompt, got: submissions.length, total: expected.length });
      } else if (submissions.some((s) => s.playerId === id)) {
        ctx.sendTo(id, { v: 'submitted-wait', text: 'Your card is in! Waiting for the others…' });
      } else if (seats.includes(id)) {
        refillHand(id);
        sendHand(id);
      }
      return;
    }
    if (phase === 'judge') {
      if (id === judgeId) {
        ctx.sendTo(id, { v: 'judge-pick', prompt, options: submissions.map((s) => ({ key: s.key, text: s.card })) });
      } else {
        ctx.sendTo(id, { v: 'submitted-wait', text: 'Cards are in! The judge is deciding…' });
      }
    }
  }

  /* ---------- module interface ---------- */
  return {
    start() {
      renderShell();
      seats = ctx.players().map((p) => p.id);
      for (const id of seats) scores.set(id, 0);
      startRound();
    },

    onMessage(playerId, data) {
      if (!data || typeof data !== 'object') return;

      if (data.a === 'pick' && phase === 'submit' && playerId !== judgeId) {
        const hand = hands.get(playerId) || [];
        const i = hand.indexOf(data.card);
        if (i === -1 || submissions.some((s) => s.playerId === playerId)) return;
        hand.splice(i, 1);
        submissions.push({ playerId, card: data.card, key: '' });
        ctx.sendTo(playerId, { v: 'submitted-wait', text: 'Your card is in! Waiting for the others…' });
        renderSubmissionSlots();
        const expected = connectedSeats().filter((id) => id !== judgeId);
        el.status.textContent = `${submissions.length} of ${expected.length} cards are in…`;
        ctx.sendTo(judgeId, { v: 'judge-wait', prompt, got: submissions.length, total: expected.length });
        maybeStartJudging();
        return;
      }

      if (data.a === 'crown' && phase === 'judge' && playerId === judgeId) {
        crownWinner(data.key);
        return;
      }

      // Game-over controls, honored only from the party host's phone.
      const isPartyHost = ctx.hostPlayerId && playerId === ctx.hostPlayerId();
      if (phase === 'gameover' && isPartyHost) {
        if (data.a === 'again') resetGame();
        else if (data.a === 'menu') ctx.exit();
      }
    },

    onPlayerJoin(player) {
      // Joiners are seated and dealt in at the start of the next round.
      ctx.sendTo(player.id, { v: 'wait', text: 'You\u2019re in! You\u2019ll be dealt cards next round.' });
      if (phase === 'paused') startRound();
      renderScores();
    },

    onPlayerLeave(playerId) {
      renderScores();
      if (phase === 'submit') {
        if (playerId === judgeId) {
          // Judge left mid-round: toss the round and move on.
          for (const s of submissions) discard.push(s.card);
          showBanner('🙈 The judge disappeared! Skipping this round…', 'pause');
          ctx.sendAll({ v: 'wait', text: 'The judge left — new round starting…' });
          clearTimeout(resultTimer);
          resultTimer = setTimeout(startRound, 2500);
        } else {
          renderSubmissionSlots();
          maybeStartJudging();
        }
      } else if (phase === 'judge' && playerId === judgeId) {
        for (const s of submissions) discard.push(s.card);
        showBanner('🙈 The judge disappeared! Skipping this round…', 'pause');
        ctx.sendAll({ v: 'wait', text: 'The judge left — new round starting…' });
        clearTimeout(resultTimer);
        resultTimer = setTimeout(startRound, 2500);
      }
    },

    onPlayerRejoin(player) {
      renderScores();
      if (phase === 'submit' || phase === 'judge') renderSubmissionSlots();
      resendView(player.id);
      if (phase === 'paused') startRound();
    },

    destroy() {
      clearTimeout(resultTimer);
      ctx.root.innerHTML = '';
    },
  };
}

/* ============================================================
   CONTROLLER (phone)
   ============================================================ */
function createController(ctx) {
  let picked = null;

  function waitView(emoji, text) {
    ctx.root.innerHTML = `
      <div class="ctrl-wait">
        <div class="ctrl-wait-emoji">${emoji}</div>
        <p>${text}</p>
      </div>`;
  }

  function handView(data) {
    picked = null;
    ctx.root.innerHTML = `
      <div class="tbc">
        <div class="tbc-prompt">
          <span class="tbc-prompt-label">${escapeHtml(data.judgeName)} is judging</span>
          <span class="tbc-prompt-text">${escapeHtml(data.prompt)}</span>
        </div>
        <p class="tbc-hint">Tap the card that fits best (or is the funniest):</p>
        <div class="tbc-hand"></div>
        <button class="ctrl-btn ctrl-btn-big tbc-play" disabled>Play this card</button>
      </div>`;

    const handEl = ctx.root.querySelector('.tbc-hand');
    const playBtn = ctx.root.querySelector('.tbc-play');

    for (const card of data.cards) {
      const btn = document.createElement('button');
      btn.className = 'tbc-card';
      btn.innerHTML = `<span>${escapeHtml(card)}</span>`;
      btn.addEventListener('click', () => {
        picked = card;
        for (const c of handEl.children) c.classList.remove('sel');
        btn.classList.add('sel');
        playBtn.disabled = false;
      });
      handEl.appendChild(btn);
    }

    playBtn.addEventListener('click', () => {
      if (!picked) return;
      playBtn.disabled = true;
      ctx.send({ a: 'pick', card: picked });
    });
  }

  function judgeWaitView(data) {
    ctx.root.innerHTML = `
      <div class="tbc">
        <div class="tbc-prompt judge">
          <span class="tbc-prompt-label">You are the Banana Judge 🍌⚖️</span>
          <span class="tbc-prompt-text">${escapeHtml(data.prompt)}</span>
        </div>
        <div class="ctrl-wait">
          <div class="ctrl-wait-emoji">⏳</div>
          <p>Waiting for cards…<br><b>${data.got} of ${data.total}</b> are in.</p>
        </div>
      </div>`;
  }

  function judgePickView(data) {
    ctx.root.innerHTML = `
      <div class="tbc">
        <div class="tbc-prompt judge">
          <span class="tbc-prompt-label">Crown the Top Banana 👑</span>
          <span class="tbc-prompt-text">${escapeHtml(data.prompt)}</span>
        </div>
        <p class="tbc-hint">Which card wins?</p>
        <div class="tbc-hand"></div>
      </div>`;
    const handEl = ctx.root.querySelector('.tbc-hand');
    for (const opt of data.options) {
      const btn = document.createElement('button');
      btn.className = 'tbc-card gold';
      btn.innerHTML = `<span>${escapeHtml(opt.text)}</span>`;
      btn.addEventListener('click', () => {
        for (const c of handEl.children) c.disabled = true;
        btn.classList.add('sel');
        ctx.send({ a: 'crown', key: opt.key });
      });
      handEl.appendChild(btn);
    }
  }

  function resultView(data) {
    waitView(
      data.youWon ? '🏆' : '👏',
      data.youWon
        ? `<b>You won the round!</b><br>“${escapeHtml(data.card)}”`
        : `<b>${escapeHtml(data.winnerName)}</b> won with<br>“${escapeHtml(data.card)}”`
    );
  }

  return {
    start() { waitView('🍌', 'Get ready…'); },

    onMessage(data) {
      if (!data || typeof data !== 'object') return;
      switch (data.v) {
        case 'wait':           waitView('🍌', escapeHtml(data.text || 'Hang tight…')); break;
        case 'hand':           handView(data); break;
        case 'submitted-wait': waitView('✅', escapeHtml(data.text || 'Card played!')); break;
        case 'judge-wait':     judgeWaitView(data); break;
        case 'judge-pick':     judgePickView(data); break;
        case 'round-result':   resultView(data); break;
        case 'gameover': {
          const line = data.winnerName
            ? `<b>${escapeHtml(data.winnerName)}</b> is the Top Banana!`
            : 'Game over!';
          if (ctx.isHost && ctx.isHost()) {
            ctx.root.innerHTML = `
              <div class="ctrl-wait">
                <div class="ctrl-wait-emoji">🍌👑</div>
                <p>${line}</p>
                <button class="ctrl-btn ctrl-btn-big tbc-again">Play again</button>
                <button class="ctrl-btn ctrl-btn-big ctrl-btn-soft tbc-menu">Back to menu</button>
              </div>`;
            ctx.root.querySelector('.tbc-again').addEventListener('click', () => ctx.send({ a: 'again' }));
            ctx.root.querySelector('.tbc-menu').addEventListener('click', () => ctx.send({ a: 'menu' }));
          } else {
            waitView('🍌👑', line + '<br>Watch the big screen.');
          }
          break;
        }
      }
    },

    destroy() { ctx.root.innerHTML = ''; },
  };
}

export default {
  id: 'topbanana',
  title: 'Top Banana',
  tagline: 'Play your funniest card — the judge decides',
  emoji: '🍌',
  minPlayers: 3,
  maxPlayers: 10,
  comingSoon: false,
  createHost,
  createController,
};
