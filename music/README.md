# Music

Drop `.mp3` files in this folder and push. In the game, the 🎵 button plays them
in shuffled order (tap again to pause). The song name shown in the game is the
file name without `.mp3`, so `Sweet_Caroline.mp3` shows as "Sweet Caroline".

The game finds the songs through GitHub's file listing for this folder. To pick
the songs or their order yourself, add a `playlist.json` here listing the file
names, for example `["First Song.mp3", "Second Song.mp3"]`.

Large files make the game slower to start a song on a phone connection, so
keep them reasonably small (128 kbps is plenty).
