require "test_helper"

class RoomTest < ActiveSupport::TestCase
  test "opening a room assigns a readable code and a shared seed" do
    room = Room.open!(host_name: "Josiah", host_character: "farag")

    assert_equal Room::CODE_LENGTH, room.code.length
    assert room.seed.present?, "a room must carry a seed so both peers build the same simulation"
    assert_equal "waiting", room.status
    refute room.full?
  end

  test "codes avoid glyphs that are ambiguous when read aloud" do
    forbidden = %w[O 0 I 1]
    50.times do
      code = Room.open!(host_name: "A", host_character: "farag").code
      assert_empty code.chars & forbidden, "#{code} contains an ambiguous character"
    end
  end

  test "codes are unique" do
    codes = 40.times.map { Room.open!(host_name: "A", host_character: "farag").code }
    assert_equal codes.size, codes.uniq.size
  end

  test "two peers get different seeds in different rooms" do
    a = Room.open!(host_name: "A", host_character: "farag")
    b = Room.open!(host_name: "B", host_character: "elias")
    refute_equal a.seed, b.seed
  end

  test "joining fills the room and marks it ready" do
    room = Room.open!(host_name: "Host", host_character: "asal")
    room.join!(guest_name: "Guest", guest_character: "coll")

    assert room.full?
    assert_equal "ready", room.status
    assert_equal "coll", room.guest_character
  end

  test "blank names fall back to sensible defaults" do
    room = Room.open!(host_name: "   ", host_character: "asal")
    assert_equal "Player 1", room.host_name

    room.join!(guest_name: "", guest_character: "coll")
    assert_equal "Player 2", room.guest_name
  end

  test "stream name is scoped to the room" do
    room = Room.open!(host_name: "A", host_character: "farag")
    assert_equal "match:#{room.code}", room.stream_name
  end

  test "joinable excludes full and stale rooms" do
    open_room = Room.open!(host_name: "A", host_character: "farag")
    full_room = Room.open!(host_name: "B", host_character: "farag")
    full_room.join!(guest_name: "C", guest_character: "elias")
    stale = Room.open!(host_name: "D", host_character: "farag")
    stale.update_column(:created_at, 3.hours.ago)

    joinable = Room.joinable
    assert_includes joinable, open_room
    refute_includes joinable, full_room
    refute_includes joinable, stale
  end
end
