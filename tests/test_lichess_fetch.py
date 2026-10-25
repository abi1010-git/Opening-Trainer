import unittest
from unittest.mock import Mock, patch

import requests
from src.lichess_fetch import fetch_recent_pgn, LichessRequestError, LichessUserNotFound


class ExportTests(unittest.TestCase):
    @patch("src.lichess_fetch.requests.get")
    def test_export_parameters_and_pgn(self, get):
        get.return_value = Mock(status_code=200, text='[Event "Test"]\n\n1. e4 *')
        self.assertIn('1. e4', fetch_recent_pgn(' player ', 3))
        args, kwargs = get.call_args
        self.assertTrue(args[0].endswith('/player'))
        self.assertEqual(kwargs['params']['max'], 3)
        self.assertEqual(kwargs['timeout'], (10, 60))

    @patch("src.lichess_fetch.requests.get")
    def test_upstream_failures(self, get):
        for code, error, message in [(404, LichessUserNotFound, 'not found'),
                                     (429, LichessRequestError, 'one minute'),
                                     (503, LichessRequestError, 'HTTP 503')]:
            with self.subTest(code=code):
                get.return_value = Mock(status_code=code)
                with self.assertRaisesRegex(error, message):
                    fetch_recent_pgn('player')

    @patch("src.lichess_fetch.requests.get")
    def test_empty_export_and_unexpected_response(self, get):
        get.return_value = Mock(status_code=200, text='')
        self.assertEqual(fetch_recent_pgn('player'), '')
        get.return_value.text = '<html>Service unavailable</html>'
        with self.assertRaisesRegex(LichessRequestError, 'unexpected'):
            fetch_recent_pgn('player')

    @patch("src.lichess_fetch.requests.get", side_effect=requests.Timeout)
    def test_timeout(self, get):
        with self.assertRaisesRegex(LichessRequestError, 'too long'):
            fetch_recent_pgn('player')


if __name__ == '__main__':
    unittest.main()
