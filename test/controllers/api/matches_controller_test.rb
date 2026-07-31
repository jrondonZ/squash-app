require "test_helper"

module Api
  class MatchesControllerTest < ActionDispatch::IntegrationTest
    def payload(**overrides)
      {
        playerOne: "Ali Farag",
        playerTwo: "Diego Elias",
        characterOne: "farag",
        characterTwo: "elias",
        games: [ 3, 1 ],
        gameScores: [ [ 11, 8 ], [ 9, 11 ], [ 11, 6 ], [ 12, 10 ] ],
        winner: 0,
        durationSeconds: 2400,
        totalRallies: 88,
        longestRally: 41
      }.merge(overrides)
    end

    test "records a completed match" do
      assert_difference -> { Match.count }, 1 do
        post api_matches_path, params: { match: payload }, as: :json
      end

      assert_response :created
      body = response.parsed_body
      assert_equal [ 3, 1 ], body["games"]
      assert_equal 41, body["longestRally"]
      assert body["playedAt"].present?
    end

    test "rejects an impossible scoreline" do
      assert_no_difference -> { Match.count } do
        post api_matches_path,
             params: { match: payload(gameScores: [ [ 11, 10 ] ], games: [ 1, 0 ]) }, as: :json
      end

      assert_response :unprocessable_entity
      assert_match(/not a legal squash score/, response.parsed_body["error"])
    end

    test "lists recent matches newest first" do
      3.times { |i| post api_matches_path, params: { match: payload(playerOne: "P#{i}") }, as: :json }

      get api_matches_path, params: { limit: 2 }

      assert_response :success
      body = response.parsed_body
      assert_equal 2, body.length
      assert_equal "P2", body.first["playerOne"]
    end

    test "clamps an absurd limit rather than dumping the table" do
      get api_matches_path, params: { limit: 100_000 }
      assert_response :success
    end

    test "ladder reports a record per character" do
      post api_matches_path, params: { match: payload }, as: :json

      get api_ladder_path

      assert_response :success
      characters = response.parsed_body.map { |entry| entry["characterId"] }
      assert_includes characters, "farag"
      assert_includes characters, "elias"
    end
  end
end
