import io
import unittest
import chess
import chess.pgn
import app

class OpeningTests(unittest.TestCase):
    def classify(self, moves, eco='D00'):
        game = chess.pgn.read_game(io.StringIO(moves+' *'))
        self.assertFalse(game.errors)
        return app.best_opening_info(game, eco)

    def test_known_openings_and_wrong_header(self):
        cases = [
            ('1. e4 e5 2. Nf3 Nc6 3. Bb5', 'C60', 'Ruy Lopez'),
            ('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6', 'B90', 'Najdorf'),
            ('1. d4 d5 2. c4 e6', 'D30', "Queen's Gambit Declined"),
            ('1. e4 e6 2. d4 d5', 'C00', 'French'),
            ('1. e4 c6 2. d4 d5', 'B12', 'Caro-Kann'),
            ('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5', 'C50', 'Italian'),
            ('1. e4 a6', 'B00', 'George'),
        ]
        for moves, eco, name in cases:
            with self.subTest(moves=moves):
                result = self.classify(moves)
                self.assertEqual(result['eco'], eco)
                self.assertIn(name, result['name'])

    def test_early_deviation_does_not_invent_variation(self):
        result = self.classify('1. e4 c5 2. Nf3 d6 3. Bc4', 'B90')
        self.assertNotIn('Najdorf', result['name'])

    def test_transposition(self):
        a = self.classify('1. d4 d5 2. e4 e6')
        b = self.classify('1. e4 e6 2. d4 d5')
        self.assertEqual(a['eco'], b['eco'])
        self.assertEqual(a['name'], b['name'])

    def test_empty_game_does_not_trust_eco(self):
        self.assertEqual(app.best_opening_info(chess.pgn.Game(), 'D00')['source'], 'unknown')

    def test_database_is_complete_and_named(self):
        self.assertEqual(len(app.OPENING_LINES), 3865)
        self.assertTrue(all(e['name'] != e['eco'] for e in app.OPENING_LINES))
