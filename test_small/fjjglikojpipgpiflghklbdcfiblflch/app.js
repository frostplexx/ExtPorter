jQuery(function() {
  setInterval(function() {
    jQuery('.gc-message-sms-more').each(function(i,v) {
      v = jQuery(v);
      if (v.children().length === 1) { // If the conversation hasn't already been processed
	v.append('<a href="javascript://" class="gc-message-sms-more">Show 5 more</a>').click(function() {
	  show(v, 5);
	});
        show(v, 5);
      }
    });
  }, 500);
});

function show(v, n) {
  v.next('.gc-message-sms-old')
    .children()
    .slice(-n)
    .insertAfter(v.next('.gc-message-sms-old'))
    .hide()
    .slideDown();
  update_links(v);
}

function update_links(v) {
  var c = v.next('.gc-message-sms-old').children().length;
  if (c > 0) {
    v.children('a.gc-message-sms-show')
      .html(
	c + (c === 1 ? "more message" : " more messages")
      );
    if (c < 5) {
      v.children('a.gc-message-sms-more')
        .html(
          "Show " + c + " more"
        );
    }
  } else {
    v.next('.gc-message-sms-old').remove();
    v.remove();
  }
}
