import pytest

from ultrastar_wingman.songs.fingerprint import fingerprint


@pytest.mark.parametrize(
    ("artist", "title", "expected"),
    [
        ("ABBA", "Dancing Queen", "abba|dancingqueen"),
        # Punctuation, spacing and case never matter.
        ("P!nk", "Don't Stop", "pnk|dontstop"),
        ("  AC/DC  ", "T.N.T.", "acdc|tnt"),
        # Featured artists become artists, the title keeps only its own name.
        ("Mark Ronson feat. Bruno Mars", "Uptown Funk", "brunomars&markronson|uptownfunk"),
        ("Eminem", "Stan feat. Dido", "eminem|stan"),
        ("Jay-Z ft. Alicia Keys", "Empire State Of Mind", "aliciakeys&jayz|empirestateofmind"),
        # Artist separators; only " x " and " + " with spaces, so real names survive.
        ("Simon & Garfunkel", "The Boxer", "garfunkel&simon|theboxer"),
        ("Tiesto x Karol G", "Don't Be Shy", "karolg&tiesto|dontbeshy"),
        ("Nena + Kim Wilde", "Anyplace Anywhere", "kimwilde&nena|anyplaceanywhere"),
        ("Xzibit", "X", "xzibit|x"),
        ("+44", "When Your Heart Stops Beating", "44|whenyourheartstopsbeating"),
        # Trailing groups and variant markers behind a dash are noise.
        ("Queen", "Bohemian Rhapsody (Live)", "queen|bohemianrhapsody"),
        ("Queen", "Bohemian Rhapsody (Live) [Remastered]", "queen|bohemianrhapsody"),
        ("Queen", "Bohemian Rhapsody [Duet]", "queen|bohemianrhapsody"),
        ("Mark Ronson", "Uptown Funk - Radio Edit", "markronson|uptownfunk"),
        ("Nirvana", "About A Girl - Live At The Paramount", "nirvana|aboutagirl"),
        # A dash that is part of the title stays: the tail is no variant marker.
        ("Demi Lovato", "Stone Cold - Sober", "demilovato|stonecoldsober"),
        # Unicode: NFKC + casefold, alphanumerics of any script survive.
        ("Björk", "Jóga", "björk|jóga"),
        # Decomposed umlauts (macOS file names) reach the same fingerprint.
        ("Björk", "Jóga", "björk|jóga"),
        ("Straße", "Grüße", "strasse|grüsse"),
        ("ＡＢＢＡ", "Ｄancing Queen", "abba|dancingqueen"),
        ("初音ミク", "メルト", "初音ミク|メルト"),
        ("Sigur Rós", "Hoppípolla 🎤", "sigurrós|hoppípolla"),
        # Nothing usable is still a valid (colliding) fingerprint.
        ("", "(Live)", "|"),
    ],
)
def test_fingerprint(artist: str, title: str, expected: str) -> None:
    assert fingerprint(artist, title) == expected


@pytest.mark.parametrize(
    ("first", "second"),
    [
        # The same song from two sources must collide.
        (
            ("Mark Ronson feat. Bruno Mars", "Uptown Funk"),
            ("Bruno Mars & Mark Ronson", "UPTOWN FUNK"),
        ),
        (("Queen", "Bohemian Rhapsody"), ("QUEEN", "Bohemian Rhapsody (Live)")),
        (("Straße", "Grüße"), ("Strasse", "Grüsse")),
        (("Sia", "Chandelier"), ("Sia", "Chandelier - Piano Version")),
    ],
)
def test_the_same_song_collides(first: tuple[str, str], second: tuple[str, str]) -> None:
    assert fingerprint(*first) == fingerprint(*second)


@pytest.mark.parametrize(
    ("first", "second"),
    [
        (("ABBA", "Dancing Queen"), ("ABBA", "Mamma Mia")),
        (("ABBA", "Dancing Queen"), ("Erasure", "Dancing Queen")),
        # A dashed subtitle is not a variant marker, so these stay different songs.
        (("Demi Lovato", "Stone Cold"), ("Demi Lovato", "Stone Cold - Sober")),
    ],
)
def test_different_songs_do_not_collide(first: tuple[str, str], second: tuple[str, str]) -> None:
    assert fingerprint(*first) != fingerprint(*second)
