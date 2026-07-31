require "test_helper"

module Api
  class RoomsControllerTest < ActionDispatch::IntegrationTest
    # Joining broadcasts to the room's cable stream, so this suite needs the
    # ActionCable test helpers as well as the HTTP ones.
    include ActionCable::TestHelper

    test "creating a room returns a code and a seed" do
      post api_rooms_path, params: { host_name: "Josiah", host_character: "farag" }, as: :json

      assert_response :created
      body = response.parsed_body
      assert body["code"].present?
      assert body["seed"].present?
      assert_equal "waiting", body["status"]
      assert_nil body["guestName"]
    end

    test "a room can be fetched by code, case-insensitively" do
      room = Room.open!(host_name: "Host", host_character: "asal")

      get api_room_path(code: room.code.downcase)

      assert_response :success
      assert_equal room.code, response.parsed_body["code"]
    end

    test "an unknown code is a 404 rather than a 500" do
      get api_room_path(code: "ZZZZ")

      assert_response :not_found
      assert response.parsed_body["error"].present?
    end

    test "joining a room fills it and returns the shared seed" do
      room = Room.open!(host_name: "Host", host_character: "asal")

      post join_api_room_path(code: room.code),
           params: { guest_name: "Rival", guest_character: "coll" }, as: :json

      assert_response :success
      body = response.parsed_body
      assert_equal "ready", body["status"]
      assert_equal "Rival", body["guestName"]
      assert_equal room.seed, body["seed"], "both peers must simulate from the same seed"
    end

    test "a third player cannot join a full room" do
      room = Room.open!(host_name: "Host", host_character: "asal")
      room.join!(guest_name: "Rival", guest_character: "coll")

      post join_api_room_path(code: room.code),
           params: { guest_name: "Gatecrasher", guest_character: "farag" }, as: :json

      assert_response :conflict
      assert_equal "Rival", room.reload.guest_name
    end

    test "joining broadcasts to the room so the host knows to start" do
      room = Room.open!(host_name: "Host", host_character: "asal")

      assert_broadcasts room.stream_name, 1 do
        post join_api_room_path(code: room.code),
             params: { guest_name: "Rival", guest_character: "coll" }, as: :json
      end
    end
  end
end
