import unittest
import chess
from app import app

class PracticeTests(unittest.TestCase):
    def test_legal_moves(self):
        with app.test_client() as client:
            result = client.post('/practice/legal-moves', json={'fen': chess.STARTING_FEN})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(len(result.json['moves']), 20)
            self.assertIn('e2e4', result.json['moves'])
            self.assertNotIn('e2e5', result.json['moves'])

    def test_invalid_positions(self):
        with app.test_client() as client:
            for payload in [{}, {'fen':'bad'}, {'fen':None}, []]:
                self.assertEqual(client.post('/practice/legal-moves', json=payload).status_code, 400)

    def test_promotions(self):
        with app.test_client() as client:
            result = client.post('/practice/legal-moves', json={'fen':'7k/P7/8/8/8/8/8/7K w - - 0 1'})
            self.assertTrue({'a7a8q','a7a8r','a7a8b','a7a8n'}.issubset(result.json['moves']))

class RecurringTests(unittest.TestCase):
    def test_singletons_are_not_recurring(self):
        from unittest.mock import patch, MagicMock
        import app as module
        import chess.engine
        pgn = '[Event "Test"]\n[White "tester"]\n[Black "opponent"]\n[Result "*"]\n\n1. e4 *\n\n'
        for count in [1, 2]:
            with self.subTest(games=count):
                engine = MagicMock()
                engine.__enter__.return_value = engine
                before = {'score': chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE), 'pv': [chess.Move.from_uci('d2d4')]}
                after = {'score': chess.engine.PovScore(chess.engine.Cp(-200), chess.WHITE), 'pv': [chess.Move.from_uci('e7e5')]}
                engine.analyse.side_effect = [before, after] * count
                with patch.object(module, 'verify_lichess_user', return_value='tester'), patch.object(module, 'fetch_recent_pgn', return_value=pgn*count), patch.object(module, 'resolve_stockfish_path', return_value='stockfish'), patch.object(module.chess.engine.SimpleEngine, 'popen_uci', return_value=engine):
                    result = module.analyze_opening_mistakes('tester', count, 2, 6)
                self.assertEqual(result['total_mistakes'], count)
                self.assertEqual(result['recurring_mistake_count'], 0 if count == 1 else 1)
