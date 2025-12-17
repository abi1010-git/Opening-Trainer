import chess

def opening_positions(game, plies: int = 10):
    board = game.board()
    positions = []  # list of (ply_index, fen_before, move_uci)
    for i, move in enumerate(game.mainline_moves()):
        if i >= plies:
            break
        fen_before = board.fen()
        positions.append((i+1, fen_before, move.uci()))
        board.push(move)
    return positions
