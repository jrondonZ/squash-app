require "test_helper"

class MatchTest < ActiveSupport::TestCase
  def valid_attributes(**overrides)
    {
      player_one: "Ali Farag",
      player_two: "Diego Elias",
      character_one: "farag",
      character_two: "elias",
      games_one: 3,
      games_two: 1,
      game_scores: [ [ 11, 8 ], [ 9, 11 ], [ 11, 6 ], [ 12, 10 ] ],
      winner: 0,
      duration_seconds: 2400,
      total_rallies: 88,
      longest_rally: 41
    }.merge(overrides)
  end

  test "accepts a legal match" do
    assert Match.new(valid_attributes).valid?
  end

  test "rejects a winner who did not win more games" do
    match = Match.new(valid_attributes(winner: 1))
    refute match.valid?
    assert_includes match.errors[:winner], "does not match the games won"
  end

  test "rejects a game that did not reach eleven" do
    match = Match.new(valid_attributes(game_scores: [ [ 10, 8 ] ], games_one: 1, games_two: 0))
    refute match.valid?
    assert_match(/not a legal squash score/, match.errors[:game_scores].first)
  end

  test "rejects a game won by a single point" do
    # Point-a-rally to 11 requires a two-point margin, so 11-10 is impossible.
    match = Match.new(valid_attributes(game_scores: [ [ 11, 10 ] ], games_one: 1, games_two: 0))
    refute match.valid?
    assert_match(/11-10/, match.errors[:game_scores].first)
  end

  test "accepts an extended game beyond eleven" do
    match = Match.new(valid_attributes(game_scores: [ [ 15, 13 ] ], games_one: 1, games_two: 0, winner: 0))
    assert match.valid?, match.errors.full_messages.to_sentence
  end

  test "rejects more games than a best-of-five allows" do
    refute Match.new(valid_attributes(games_one: 4)).valid?
  end

  test "identifies the winning and losing characters" do
    match = Match.new(valid_attributes)
    assert_equal "farag", match.winner_character
    assert_equal "elias", match.loser_character
  end

  test "renders a scoreline" do
    assert_equal "11-8, 9-11, 11-6, 12-10", Match.new(valid_attributes).scoreline
  end

  test "ladder aggregates played, won and games for each character" do
    Match.create!(valid_attributes)
    Match.create!(valid_attributes(
      character_one: "elias", character_two: "farag",
      games_one: 3, games_two: 0, winner: 0,
      game_scores: [ [ 11, 4 ], [ 11, 9 ], [ 11, 7 ] ]
    ))

    ladder = Match.ladder.index_by { |entry| entry[:characterId] }

    assert_equal 2, ladder["farag"][:played]
    assert_equal 1, ladder["farag"][:won]
    assert_equal 0.5, ladder["farag"][:winRate]

    assert_equal 2, ladder["elias"][:played]
    assert_equal 1, ladder["elias"][:won]
  end

  test "ladder is ordered by win rate" do
    Match.create!(valid_attributes)
    rates = Match.ladder.map { |entry| entry[:winRate] }
    assert_equal rates.sort.reverse, rates
  end
end
