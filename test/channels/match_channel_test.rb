require "test_helper"

class MatchChannelTest < ActionCable::Channel::TestCase
  setup do
    @room = Room.open!(host_name: "Host", host_character: "asal")
  end

  test "subscribes to the room's own stream" do
    subscribe room: @room.code

    assert subscription.confirmed?
    assert_has_stream @room.stream_name
  end

  test "accepts a lowercase room code" do
    subscribe room: @room.code.downcase

    assert subscription.confirmed?
    assert_has_stream @room.stream_name
  end

  test "rejects a subscription to a room that does not exist" do
    subscribe room: "ZZZZ"

    assert subscription.rejected?
  end

  test "relays a payload to the room" do
    subscribe room: @room.code

    assert_broadcast_on(@room.stream_name, { "t" => "ping", "at" => 1 }) do
      perform :relay, payload: { t: "ping", at: 1 }
    end
  end

  test "ignores an empty payload" do
    subscribe room: @room.code

    assert_no_broadcasts @room.stream_name do
      perform :relay, payload: nil
    end
  end

  test "drops a payload larger than the cap" do
    subscribe room: @room.code

    oversized = "x" * (MatchChannel::MAX_PAYLOAD_BYTES + 1)

    assert_no_broadcasts @room.stream_name do
      perform :relay, payload: oversized
    end
  end

  test "tells the other peer when someone leaves" do
    subscribe room: @room.code

    assert_broadcast_on(@room.stream_name, { "t" => "leave" }) do
      unsubscribe
    end
  end
end
